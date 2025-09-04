'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
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

  for (const tmpUpload of tmpUploads) {
    await t.assert.rejects(fs.access(tmpUpload))
  }
})
