'use strict'

const test = require('node:test')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const Fastify = require('fastify')
const multipart = require('..')

const BOUNDARY = 'ghsa-c9pp-p9r3-vv86'

function multipartBody (filenames) {
  const parts = filenames.map((name, i) => {
    return `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="f${i}"; filename="${name}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n' +
      'payload-bytes\r\n'
  })
  return Buffer.from(parts.join('') + `--${BOUNDARY}--\r\n`)
}

test('saveRequestFiles does not leak an NTFS alternate data stream path (GHSA-c9pp-p9r3-vv86)', async function (t) {
  // Regression test for the advisory: a client-supplied filename whose extension
  // contains ':' (e.g. 'a.txt:s') must not reach the temp path. On NTFS ':' is
  // the alternate data stream separator, so writing to '<id>.txt:s' would create
  // an empty '<id>.txt' that survives cleanup.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-ghsa-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const app = Fastify()
  t.after(() => app.close())

  await app.register(multipart)

  app.post('/upload', async (req) => {
    const { files } = await req.saveRequestFiles({ tmpdir: dir })
    return { saved: files.map(f => ({ filename: f.filename, filepath: path.basename(f.filepath) })) }
  })

  const res = await app.inject({
    method: 'POST',
    url: '/upload',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipartBody(['a.txt:s'])
  })

  t.assert.strictEqual(res.statusCode, 200)
  const { saved } = res.json()
  t.assert.strictEqual(saved.length, 1)

  // The original filename is preserved on the returned file object...
  t.assert.strictEqual(saved[0].filename, 'a.txt:s')
  // ...but the temp file must not carry the ':' extension.
  t.assert.ok(!saved[0].filepath.endsWith('.txt:s'), `temp path must not be an ADS path: ${saved[0].filepath}`)
  t.assert.strictEqual(path.extname(saved[0].filepath), '')

  // The response lifecycle cleans up the temp files: nothing may be left behind.
  const left = fs.readdirSync(dir)
  t.assert.deepStrictEqual(left, [])
})

test('saveRequestFiles still keeps a safe extension', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-ghsa-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const app = Fastify()
  t.after(() => app.close())

  await app.register(multipart)

  app.post('/upload', async (req) => {
    const { files } = await req.saveRequestFiles({ tmpdir: dir })
    return { saved: files.map(f => path.basename(f.filepath)) }
  })

  const res = await app.inject({
    method: 'POST',
    url: '/upload',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipartBody(['a.txt'])
  })

  t.assert.strictEqual(res.statusCode, 200)
  const { saved } = res.json()
  // A safe extension is preserved for type hinting.
  t.assert.match(saved[0], /\.txt$/)
  const left = fs.readdirSync(dir)
  t.assert.deepStrictEqual(left, [])
})
