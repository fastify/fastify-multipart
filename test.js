'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('.')
const http = require('http')
const path = require('path')
const fs = require('fs')
const pump = require('pump')
const concat = require('concat-stream')

const filePath = path.join(__dirname, 'README.md')

test('should parse forms', function (t) {
  t.plan(10)

  const fastify = Fastify()

  fastify.register(multipart)

  fastify.post('/', function (req, reply) {
    t.ok(req.isMultipart())

    const mp = req.multipart(handler, function (err) {
      t.error(err)
    })

    mp.on('field', function (name, value) {
      t.equal(name, 'hello')
      t.equal(value, 'world')
    })

    function handler (field, file, filename, encoding, mimetype) {
      t.equal(filename, 'README.md')
      t.equal(field, 'upload')
      t.equal(encoding, '7bit')
      t.equal(mimetype, 'text/markdown')
      var original = fs.readFileSync(filePath, 'utf8')
      file.pipe(concat(function (buf) {
        t.equal(buf.toString(), original)
        reply.code(200).send()
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

    var req = http.request(opts, () => { fastify.close(noop) })
    var rs = fs.createReadStream(filePath)
    form.append('upload', rs)
    form.append('hello', 'world')
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should error if it is not multipart', function (t) {
  t.plan(3)

  const fastify = Fastify()

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

    var req = http.request(opts, () => { fastify.close(noop) })
    req.end(JSON.stringify({ hello: 'world' }))
  })
})

function noop () {}
