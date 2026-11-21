'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const { once } = require('node:events')

// Reproduces https://github.com/fastify/fastify-multipart/issues/470
// saveRequestFiles() kept writing every following part to disk after a file
// had been truncated by limits.fileSize, and only threw once the whole request
// had been read.
async function upload (fastify, form) {
  const req = http.request({
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  })
  req.on('error', () => {})
  form.pipe(req)
  const [res] = await once(req, 'response')
  res.resume()
  await once(res, 'end')
  return res
}

test('saveRequestFiles throws as soon as a file hits the fileSize limit and leaves no temp file', async function (t) {
  t.plan(6)

  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(multipart)

  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'multipart-'))
  t.after(() => fs.rm(tmpdir, { recursive: true, force: true }))

  fastify.post('/', async function (req, reply) {
    try {
      await req.saveRequestFiles({ tmpdir, limits: { fileSize: 1000 } })
      t.assert.fail('it should throw')
    } catch (err) {
      t.assert.ok(err instanceof fastify.multipartErrors.RequestFileTooLargeError)
      t.assert.strictEqual(err.part.fieldname, 'big')
      // the part after the oversized one was never written to disk
      t.assert.strictEqual(req.tmpUploads.length, 1)
      t.assert.deepStrictEqual(await fs.readdir(tmpdir), [])
      await req.cleanRequestFiles()
      throw err
    }
  })

  await fastify.listen({ port: 0 })

  const form = new FormData()
  form.append('big', Buffer.alloc(2 * 1024 * 1024), { filename: 'big.bin' })
  form.append('next', Buffer.alloc(2 * 1024 * 1024), { filename: 'next.bin' })

  const res = await upload(fastify, form)
  t.assert.strictEqual(res.statusCode, 413)
  t.assert.deepStrictEqual(await fs.readdir(tmpdir), [])
})

test('saveRequestFiles keeps saving truncated files when throwFileSizeLimit is false', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(multipart)

  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'multipart-'))
  t.after(() => fs.rm(tmpdir, { recursive: true, force: true }))

  fastify.post('/', async function (req) {
    const { files } = await req.saveRequestFiles({
      tmpdir,
      throwFileSizeLimit: false,
      limits: { fileSize: 1000 }
    })
    t.assert.strictEqual(files.length, 2)
    t.assert.ok(files.every((file) => file.file.truncated))
    return 'ok'
  })

  await fastify.listen({ port: 0 })

  const form = new FormData()
  form.append('big', Buffer.alloc(64 * 1024), { filename: 'big.bin' })
  form.append('next', Buffer.alloc(64 * 1024), { filename: 'next.bin' })

  const res = await upload(fastify, form)
  t.assert.strictEqual(res.statusCode, 200)
})
