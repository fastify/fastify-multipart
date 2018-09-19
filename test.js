'use strict'
const os = require('os')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('.')
const http = require('http')
const path = require('path')
const fs = require('fs')
const pump = require('pump')
const concat = require('concat-stream')
const Readable = require('stream').Readable
const Writable = require('stream').Writable
const crypto = require('crypto')

const filePath = path.join(__dirname, 'README.md')

test('should parse forms', function (t) {
  t.plan(14)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { fields: 1 } })

  fastify.post('/', function (req, reply) {
    t.ok(req.isMultipart())

    const mp = req.multipart(handler, function (err) {
      t.error(err)
      reply.code(200).send()
    })

    mp.on('field', function (name, value) {
      t.notEqual(name, 'willbe', 'Busboy fields limit ignored')
      t.notEqual(value, 'dropped', 'Busboy fields limit ignored')
      t.equal(name, 'hello')
      t.equal(value, 'world')
    })

    function handler (field, file, filename, encoding, mimetype) {
      t.equal(filename, 'README.md')
      t.equal(field, 'upload')
      t.equal(encoding, '7bit')
      t.equal(mimetype, 'text/markdown')
      file.on('fieldsLimit', () => t.ok('field limit reached'))
      var original = fs.readFileSync(filePath, 'utf8')
      file.pipe(concat(function (buf) {
        t.equal(buf.toString(), original)
      }))
    }
  })

  fastify.listen(0, function () {
    // request
    var form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    var rs = fs.createReadStream(filePath)
    form.append('upload', rs)
    form.append('hello', 'world')
    form.append('willbe', 'dropped')
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should call finished when both files are pumped', function (t) {
  t.plan(8)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', function (req, reply) {
    var fileCount = 0
    t.ok(req.isMultipart())

    req.multipart(handler, function (err) {
      t.error(err)
      t.equal(fileCount, 2)
      reply.code(200).send()
    })

    function handler (field, file, filename, encoding, mimetype) {
      const saveTo = path.join(os.tmpdir(), path.basename(filename))
      pump(file, fs.createWriteStream(saveTo), function (err) {
        t.error(err)
        fileCount++
      })
    }
  })

  fastify.listen(0, function () {
    // request
    var form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))
    form.append('hello', 'world')
    form.append('willbe', 'dropped')
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should error if it is not multipart', function (t) {
  t.plan(4)

  const fastify = Fastify()

  t.tearDown(fastify.close.bind(fastify))
  fastify.register(multipart)

  fastify.post('/', function (req, reply) {
    t.notOk(req.isMultipart())

    req.multipart(handler, function (err) {
      t.ok(err)
      t.equal(err.message, 'the request is not multipart')
      reply.code(500).send()
    })

    function handler (field, file, filename, encoding, mimetype) {
      t.fail('this should never be called')
    }
  })

  fastify.listen(0, function () {
    // request
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      headers: {
        'content-type': 'application/json'
      },
      path: '/',
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
    })
    req.end(JSON.stringify({ hello: 'world' }))
  })
})

function noop () {}

// skipping on Travis because it takes too long
if (!process.env.TRAVIS) {
  test('should upload a big file in constant memory', function (t) {
    t.plan(12)

    const fastify = Fastify()
    const hashInput = crypto.createHash('sha256')

    t.tearDown(fastify.close.bind(fastify))

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
            t.equal(hashInput.digest('hex'), chunk.toString('hex'))
            cb()
          }
        }), function (err) {
          t.error(err)

          const memory = process.memoryUsage()
          t.ok(memory.rss < 200 * 1024 * 1024) // 200MB
          t.ok(memory.heapTotal < 200 * 1024 * 1024) // 200MB
          reply.send()
        })
      }
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

          // poor man random data
          // do not use in prod, it can leak sensitive informations
          var buf = Buffer.allocUnsafe(n)
          hashInput.update(buf)
          this.push(buf)

          total -= n

          if (total === 0) {
            t.pass('finished generating')
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
}
