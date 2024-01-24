'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const EventEmitter = require('node:events')
const { sendToWormhole } = require('stream-wormhole')
const { once } = EventEmitter

const filePath = path.join(__dirname, '../README.md')

// FIXME, this test fail
test('should throw fileSize limitation error on small payload', { skip: true }, async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const part = await req.file({ limits: { fileSize: 2 } })
    await sendToWormhole(part.file)

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
    t.equal(res.statusCode, 413)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error, 'request')
  }
})

test('should not throw and error when throwFileSizeLimit option is false', { skip: process.platform === 'win32' }, async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const part = await req.file({ limits: { fileSize: 2 }, throwFileSizeLimit: false })
    await sendToWormhole(part.file)

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
    t.equal(res.statusCode, 200)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error, 'request')
  }
})
