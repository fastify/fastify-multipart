'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('./../..')
const http = require('http')
const stream = require('readable-stream')
const Readable = stream.Readable
const Writable = stream.Writable
const pump = stream.pipeline
const eos = stream.finished
const crypto = require('crypto')

// skipping on Github Actions because it takes too long
test('should upload a big file in constant memory', { skip: process.env.CI }, function (t) {
  t.plan(12)

  const fastify = Fastify()
  const hashInput = crypto.createHash('sha256')
  let sent = false

  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', function (req, reply) {
    t.ok(req.isMultipart())

    req.multipart(handler, function (err) {
      t.error(err)
    })

    function handler (field, file, filename, encoding, mimetype) {
      t.equal(filename, 'random-data')
      t.equal(field, 'upload')
      t.equal(encoding, '7bit')
      t.equal(mimetype, 'binary/octect-stream')
      const hashOutput = crypto.createHash('sha256')

      pump(file, hashOutput, new Writable({
        objectMode: true,
        write (chunk, enc, cb) {
          if (!sent) {
            eos(hashInput, () => {
              this._write(chunk, enc, cb)
            })
            return
          }

          t.equal(hashInput.digest('hex'), chunk.toString('hex'))
          cb()
        }
      }), function (err) {
        t.error(err)

        const memory = process.memoryUsage()
        t.ok(memory.rss < 400 * 1024 * 1024) // 200MB
        t.ok(memory.heapTotal < 400 * 1024 * 1024) // 200MB
        reply.send()
      })
    }
  })

  fastify.listen(0, function () {
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
          sent = true
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

    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
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
