'use strict'

const util = require('util')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { Readable } = require('readable-stream')
const stream = require('stream')
const pump = util.promisify(stream.pipeline)
const sendToWormhole = require('stream-wormhole')
const eos = util.promisify(stream.finished)
const EventEmitter = require('events')
const { once } = EventEmitter

const filePath = path.join(__dirname, '../README.md')

test('should throw fileSize limitation error on small payload', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      await req.file({ limits: { fileSize: 2 } })
      reply.code(200).send()
    } catch (error) {
      t.true(error instanceof fastify.multipartErrors.RequestFileTooLargeError)
      reply.code(500).send()
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

  const req = http.request(opts)
  form.append('upload', fs.createReadStream(filePath))

  pump(form, req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 500)
  res.resume()
  await once(res, 'end')
})

test('should emit fileSize limitation error during streaming', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))
  const hashInput = crypto.createHash('sha256')

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    let part
    try {
      part = await req.file({ limits: { fileSize: 16500 } })
      await sendToWormhole(part.file, true)
      reply.code(200).send()
    } catch (error) {
      t.true(error instanceof fastify.multipartErrors.RequestFileTooLargeError)
      // We need to wait before the stream is drained and the busboy firing 'onEnd' event
      await eos(part.file)
      reply.code(500).send()
    }
  })

  await fastify.listen(0)

  // request
  const knownLength = 1024 * 1024 // 1MB
  let total = knownLength
  const form = new FormData({ maxDataSize: total })
  const rs = new Readable({
    read (n) {
      if (n > total) {
        n = total
      }

      var buf = Buffer.alloc(n).fill('x')
      hashInput.update(buf)
      this.push(buf)

      total -= n

      if (total === 0) {
        t.pass('finished generating')
        hashInput.end()
        this.push(null)
      }
    }
  })

  const opts = {
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const req = http.request(opts)
  form.append('upload', rs, {
    filename: 'random-data',
    contentType: 'binary/octect-stream',
    knownLength
  })

  pump(form, req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 500)
  res.resume()
  await once(res, 'end')
})

test('should ignore fileSize limitation error when no error handler was set', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))
  const hashInput = crypto.createHash('sha256')

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const part = await req.file({ limits: { fileSize: 16500 } })
    part.file.resume()
    // don't add error listener
    await eos(part.file, { error: false })
    reply.code(200).send()
  })

  await fastify.listen(0)

  // request
  const knownLength = 1024 * 1024 // 1MB
  let total = knownLength
  const form = new FormData({ maxDataSize: total })
  const rs = new Readable({
    read (n) {
      if (n > total) {
        n = total
      }

      var buf = Buffer.alloc(n).fill('x')
      hashInput.update(buf)
      this.push(buf)

      total -= n

      if (total === 0) {
        t.pass('finished generating')
        hashInput.end()
        this.push(null)
      }
    }
  })

  const opts = {
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const req = http.request(opts)
  form.append('upload', rs, {
    filename: 'random-data',
    contentType: 'binary/octect-stream',
    knownLength
  })

  pump(form, req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
})
