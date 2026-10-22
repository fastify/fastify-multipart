'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')
const { writableNoopStream } = require('noop-stream')
const { pipeline } = require('node:stream/promises')
const { once } = require('node:events')
const fs = require('node:fs/promises')

test('should finish with error on partial upload - files api', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req) {
    t.assert.ok(req.isMultipart())
    const parts = await req.files()
    try {
      for await (const part of parts) {
        await pipeline(part.file, writableNoopStream())
      }
    } catch (e) {
      t.assert.strictEqual(e.message, 'Premature close', 'File was closed prematurely')
      throw e
    } finally {
      t.assert.ok('Finished request')
    }
    return 'ok'
  })

  await fastify.listen({ port: 0 })
  const dataSize = 1024 * 6
  // request
  const form = new FormData()
  form.append('upload', Buffer.alloc(dataSize))
  const opts = {
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const req = http.request(opts)
  req.on('error', () => {
    t.assert.ok('ended http request with error')
  })
  const data = form.getBuffer()
  req.write(data.slice(0, dataSize / 2))
  await sleep(100)
  req.destroy()
  await sleep(100)
})

test('should finish with error on partial upload - saveRequestFiles', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(multipart)

  let tmpUploads
  fastify.post('/', async function (req) {
    t.assert.ok(req.isMultipart())
    try {
      await req.saveRequestFiles()
    } finally {
      tmpUploads = req.tmpUploads
    }
  })

  await fastify.listen({ port: 0 })
  const dataSize = 1024 * 1024 * 1024

  // request
  const form = new FormData()
  form.append('upload', Buffer.alloc(dataSize))
  const opts = {
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const req = http.request(opts)
  const data = form.getBuffer()
  req.write(data.slice(0, dataSize / 4))
  req.write(data.slice(dataSize / 4, dataSize / 2))
  req.end()

  const [res] = await once(req, 'response')
  t.assert.strictEqual(res.statusCode, 500)

  // Retry with exponential backoff until temp files are cleaned up.
  // File cleanup is async and may not complete immediately on macOS.
  for (const tmpUpload of tmpUploads) {
    let deleted = false
    for (let i = 0; i < 5; i++) {
      try {
        await fs.access(tmpUpload)
        await sleep(50 * Math.pow(2, i))
      } catch {
        deleted = true
        break
      }
    }
    t.assert.ok(deleted, `tmp file ${tmpUpload} should be deleted`)
  }
})

test('should clean up completed files when a later part is incomplete', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'fastify-multipart-'))
  t.after(() => fs.rm(tmpdir, { recursive: true, force: true }))
  t.after(() => fastify.close())

  await fastify.register(multipart)

  let request
  let finishRequest
  const requestFinished = new Promise((resolve) => {
    finishRequest = resolve
  })
  fastify.post('/', async function (req) {
    request = req
    t.assert.ok(req.isMultipart())
    try {
      await t.assert.rejects(req.saveRequestFiles({ tmpdir }), {
        code: 'FST_MP_PREMATURE_CLOSE'
      })
    } finally {
      finishRequest()
    }
  })

  await fastify.listen({ host: '127.0.0.1', port: 0 })

  const boundary = 'incomplete-later-part'
  const body =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="one"; filename="one.txt"\r\n\r\n' +
    'FILE-ONE-COMPLETE\r\n' +
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="two"; filename="two.txt"\r\n'

  const client = net.connect(fastify.server.address().port, '127.0.0.1')
  client.on('error', () => {})
  await once(client, 'connect')
  client.write(
    'POST / HTTP/1.1\r\n' +
    'Host: localhost\r\n' +
    `Content-Type: multipart/form-data; boundary=${boundary}\r\n` +
    `Content-Length: ${Buffer.byteLength(body) + 10000}\r\n\r\n` +
    body
  )

  for (let i = 0; i < 100 && request?.savedRequestFiles?.length !== 1; ++i) {
    await sleep(10)
  }
  t.assert.strictEqual(request.savedRequestFiles.length, 1)

  const clientClosed = once(client, 'close')
  client.destroy()
  await clientClosed
  await requestFinished

  t.assert.deepStrictEqual(await fs.readdir(tmpdir), [])
})
