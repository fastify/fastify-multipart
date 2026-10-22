'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const { setTimeout: sleep } = require('node:timers/promises')

test('should not hang or leak temp files on partial upload after fileSize limit - saveRequestFiles', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(multipart, { limits: { fileSize: 100 } })

  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'multipart-'))
  t.after(() => fs.rm(tmpdir, { recursive: true, force: true }))

  let settle
  const handlerSettled = new Promise((resolve) => { settle = resolve })
  let tmpUploads = []

  fastify.post('/', async function (req) {
    try {
      await req.saveRequestFiles({ tmpdir })
    } catch (e) {
      t.assert.strictEqual(e.message, 'Premature close', 'File was closed prematurely')
      throw e
    } finally {
      tmpUploads = req.tmpUploads
      settle()
    }
  })

  await fastify.listen({ port: 0 })

  // A file part well above the 100 byte fileSize limit, so busboy truncates it
  // and fires 'limit'. Only part of the body is sent before the abort, so the
  // closing multipart boundary is never delivered.
  const form = new FormData()
  form.append('upload', Buffer.alloc(1024))
  const opts = {
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const req = http.request(opts)
  req.on('error', () => {})
  const data = form.getBuffer()
  req.write(data.slice(0, 512))
  await sleep(150)
  req.destroy()

  const settled = await Promise.race([
    handlerSettled.then(() => true),
    sleep(3000).then(() => false)
  ])
  t.assert.ok(settled, 'handler settled instead of hanging on pump()')

  let leaked = false
  for (const tmpUpload of tmpUploads) {
    try {
      await fs.access(tmpUpload)
      leaked = true
    } catch {
      // file was cleaned up
    }
  }
  t.assert.ok(settled && !leaked, 'temp file was cleaned up, not leaked')
})
