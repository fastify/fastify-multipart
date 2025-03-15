'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const EventEmitter = require('node:events')
const streamToNull = require('../lib/stream-consumer')
const { once } = EventEmitter

const filePath = path.join(__dirname, '../README.md')

test('should throw fileSize limitation error on small payload', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const part = await req.file({ limits: { fileSize: 2 } })
    await streamToNull(part.file)

    reply.code(200).send()
  })

  await fastify.listen({ port: 0 })

  // request
  const form = new FormData()
  const opts = {
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const req = http.request(opts)
  form.append('upload', fs.createReadStream(filePath))

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 413)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.assert.ok(error, 'request')
  }
})

test('should not throw and error when throwFileSizeLimit option is false', { skip: process.platform === 'win32' }, async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const part = await req.file({ limits: { fileSize: 2 }, throwFileSizeLimit: false })
    await streamToNull(part.file)

    reply.code(200).send()
  })

  await fastify.listen({ port: 0 })

  // request
  const form = new FormData()
  const opts = {
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const req = http.request(opts)
  form.append('upload', fs.createReadStream(filePath))

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 200)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.assert.ok(error, 'request')
  }
})
