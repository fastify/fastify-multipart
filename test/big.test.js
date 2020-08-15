'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const stream = require('readable-stream')
const Readable = stream.Readable
const pump = stream.pipeline
const crypto = require('crypto')
const sendToWormhole = require('stream-wormhole')

// skipping on Github Actions because it takes too long
test('should upload a big file in constant memory', { skip: process.env.CI }, function (t) {
  t.plan(9)

  const fastify = Fastify()
  const hashInput = crypto.createHash('sha256')

  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    for await (const part of req.multipart()) {
      if (part.file) {
        t.equal(part.fieldname, 'upload')
        t.equal(part.filename, 'random-data')
        t.equal(part.encoding, '7bit')
        t.equal(part.mimetype, 'binary/octect-stream')

        await sendToWormhole(part.file)
      }
    }

    const memory = process.memoryUsage()
    t.ok(memory.rss < 400 * 1024 * 1024) // 200MB
    t.ok(memory.heapTotal < 400 * 1024 * 1024) // 200MB

    reply.send()
  })

  fastify.listen(0, function () {
    var knownLength = 1024 * 1024 * 1024
    var total = knownLength
    var form = new FormData({ maxDataSize: total })
    var rs = new Readable({
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
    form.append('upload', rs, {
      filename: 'random-data',
      contentType: 'binary/octect-stream',
      knownLength
    })

    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    var req = http.request(opts, () => { fastify.close(noop) })

    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

function noop () { }
