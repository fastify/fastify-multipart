'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const stream = require('readable-stream')
const Readable = stream.Readable
const pump = stream.pipeline
const crypto = require('node:crypto')
const streamToNull = require('../lib/stream-consumer')

// skipping on Github Actions because it takes too long
test('should upload a big file in constant memory', { skip: process.env.CI }, function (t) {
  t.plan(10)

  const fastify = Fastify()
  const hashInput = crypto.createHash('sha256')

  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, {
    limits: {
      fileSize: Infinity,
      parts: Infinity
    }
  })

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    for await (const part of req.parts()) {
      if (part.file) {
        t.equal(part.type, 'file')
        t.equal(part.fieldname, 'upload')
        t.equal(part.filename, 'random-data')
        t.equal(part.encoding, '7bit')
        t.equal(part.mimetype, 'binary/octet-stream')

        await streamToNull(part.file)
      }
    }

    const memory = process.memoryUsage()
    t.ok(memory.rss < 500 * 1024 * 1024)
    t.ok(memory.heapTotal < 500 * 1024 * 1024)

    reply.send()
  })

  fastify.listen({ port: 0 }, function () {
    const knownLength = 1024 * 1024 * 1024
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
    form.append('upload', rs, {
      filename: 'random-data',
      contentType: 'binary/octet-stream',
      knownLength
    })

    const addresses = fastify.addresses()
    const opts = {
      protocol: 'http:',
      hostname: addresses[0].address,
      port: addresses[0].port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    const req = http.request(opts, () => { fastify.close(noop) })

    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

function noop () { }
