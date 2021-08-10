'use strict'

const util = require('util')
const crypto = require('crypto')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const stream = require('stream')
const pump = util.promisify(stream.pipeline)
const EventEmitter = require('events')
const { once } = EventEmitter

test('should throw fileSize limitation error when consuming the stream', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, {
    throwFileSizeLimit: true,
    limits: {
      fileSize: 524288
    }
  })

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const part = await req.file()
    t.pass('the file is not consumed yet')

    try {
      await part.toBuffer()
      t.fail('it should throw')
    } catch (error) {
      t.ok(error)
      reply.send(error)
    }
  })

  await fastify.listen(0)

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

  const randomFileBuffer = Buffer.alloc(600000)
  crypto.randomFillSync(randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', randomFileBuffer)

  pump(form, req)

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 413)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error, 'request')
  }
})

test('should NOT throw fileSize limitation error when consuming the stream', async function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      fileSize: 524288
    }
  })
  const fileInputLength = 600000

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const part = await req.file()
    t.pass('the file is not consumed yet')

    try {
      const buffer = await part.toBuffer()
      t.ok(part.file.truncated)
      t.notSame(buffer.length, fileInputLength)
      reply.send(new fastify.multipartErrors.FilesLimitError())
    } catch (error) {
      t.fail('it should not throw')
    }
  })

  await fastify.listen(0)

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

  const randomFileBuffer = Buffer.alloc(fileInputLength)
  crypto.randomFillSync(randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', randomFileBuffer)

  pump(form, req)

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 413)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error, 'request')
  }
})
