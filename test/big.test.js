'use strict'

const test = require('node:test')
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
test('should upload a big file in constant memory', { skip: process.env.CI }, function (t, done) {
  t.plan(10)

  const fastify = Fastify()
  const hashInput = crypto.createHash('sha256')

  t.after(() => fastify.close())

  fastify.register(multipart, {
    limits: {
      fileSize: Infinity,
      parts: Infinity
    }
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    for await (const part of req.parts()) {
      if (part.file) {
        t.assert.strictEqual(part.type, 'file')
        t.assert.strictEqual(part.fieldname, 'upload')
        t.assert.strictEqual(part.filename, 'random-data')
        t.assert.strictEqual(part.encoding, '7bit')
        t.assert.strictEqual(part.mimetype, 'binary/octet-stream')

        await streamToNull(part.file)
      }
    }

    const memory = process.memoryUsage()
    t.assert.ok(memory.rss < 500 * 1024 * 1024)
    t.assert.ok(memory.heapTotal < 500 * 1024 * 1024)

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
          t.assert.ok('finished generating')
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

    const req = http.request(opts, (res) => {
      res.on('data', () => {})

      res.on('end', () => {
        fastify.close(() => {
          done()
        })
      })
    })

    pump(form, req, function (err) {
      t.assert.ifError(err, 'client pump: no err')
    })
  })
})
