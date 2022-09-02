'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const crypto = require('crypto')
const { Readable } = require('stream')
const sendToWormhole = require('stream-wormhole')
const EventEmitter = require('events')
const { once } = EventEmitter

test('should emit fileSize limitation error during streaming', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))
  const hashInput = crypto.createHash('sha256')

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())
    const part = await req.file({ limits: { fileSize: 16500 } })
    await sendToWormhole(part.file)
    if (part.file.truncated) {
      reply.code(500).send()
    } else {
      reply.code(200).send()
    }
  })

  await fastify.listen({ port: 0 })

  // request
  const knownLength = 1024 * 1024 // 1MB
  let total = knownLength
  const form = new FormData({ maxDataSize: total })
  const rs = new Readable({
    read (n) {
      if (n > total) {
        n = total
      }

      const buf = Buffer.alloc(n).fill('x')
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
    contentType: 'binary/octet-stream',
    knownLength
  })

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 500)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error, 'request')
  }
})
