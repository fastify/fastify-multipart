'use strict'
const os = require('os')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('./../..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const concat = require('concat-stream')
const stream = require('readable-stream')
const pump = stream.pipeline
const eos = stream.finished

const filePath = path.join(__dirname, '..', '..', 'README.md')

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
  t.plan(10)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', function (req, reply) {
    let fileCount = 0
    t.ok(req.isMultipart())

    req.multipart(handler, function (err) {
      t.error(err)
      t.equal(fileCount, 2)
      reply.code(200).send()
    })

    function handler (field, file, filename, encoding, mimetype) {
      const saveTo = path.join(os.tmpdir(), path.basename(filename))
      eos(file, function (err) {
        t.error(err)
        fileCount++
      })

      pump(file, fs.createWriteStream(saveTo), function (err) {
        t.error(err)
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

test('should error if it is invalid multipart', function (t) {
  t.plan(5)

  const fastify = Fastify()

  t.tearDown(fastify.close.bind(fastify))
  fastify.register(multipart)

  fastify.post('/', function (req, reply) {
    t.ok(req.isMultipart())

    req.multipart(handler, function (err) {
      t.ok(err)
      t.equal(err.message, 'Multipart: Boundary not found')
      reply.code(500).send()
    })

    function handler (field, file, filename, encoding, mimetype) {
      t.fail('this should never be called')
    }
  })

  fastify.listen(0, function () {
    // request
    var form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      headers: {
        'content-type': 'multipart/form-data'
      },
      path: '/',
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
    })
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should override options', function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { fileSize: 1 } })

  fastify.post('/', function (req, reply) {
    const mp = req.multipart(handler, function (err) {
      t.error(err)
      reply.code(200).send()
    }, { limits: { fileSize: 2 } })

    t.equal(mp.opts.limits.fileSize, 2, 'options.limits.fileSize was updated successfully')

    function handler (field, file, filename, encoding, mimetype) {
      file.pipe(concat(function (buf) { }))
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
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should not allow __proto__', function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { fields: 1 } })

  fastify.post('/', function (req, reply) {
    t.ok(req.isMultipart())

    const mp = req.multipart(handler, function (err) {
      t.is(err.message, '__proto__ is not allowed as field name')
      reply.code(500).send()
    })

    mp.on('field', function (name, value) {
      t.fail('should not be called')
    })

    function handler (field, file, filename, encoding, mimetype) {
      t.fail('should not be called')
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
      t.equal(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    var rs = fs.createReadStream(filePath)
    form.append('__proto__', rs)
    // form.append('hello', 'world')
    // form.append('willbe', 'dropped')
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})
