'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const { setTimeout: sleep } = require('node:timers/promises')
const { writableNoopStream } = require('noop-stream')
const { pipeline } = require('node:stream/promises')
const { once } = require('node:events')
const fs = require('node:fs/promises')

test('should finish with error on partial upload', async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  await fastify.register(multipart)

  let tmpUploads
  fastify.post('/', async function (req) {
    t.ok(req.isMultipart())
    try {
      await req.saveRequestFiles()
    } finally {
      tmpUploads = req.tmpUploads
    }
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
  const data = form.getBuffer()
  req.write(data.slice(0, dataSize / 2))
  req.end()

  await once(req, 'close')

  for (const tmpUpload of tmpUploads) {
    await t.rejects(fs.access(tmpUpload))
  }
})
