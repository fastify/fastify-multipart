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
const stream = require('stream')
const pump = stream.pipeline
const eos = stream.finished

const filePath = path.join(__dirname, '..', '..', 'README.md')

test('should parse forms', { skip: process.platform === 'win32' }, function (t) {
  t.plan(14)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { fields: 1 } })

  fastify.post('/', function (req, reply) {
    t.ok(req.isMultipart())

    const mp = req.multipart(handler, function (err) {
      t.error(err)
      reply.code(200).send()
    })

    mp.on('field', function (name, value) {
      t.not(name, 'willbe', 'Busboy fields limit ignored')
      t.not(value, 'dropped', 'Busboy fields limit ignored')
      t.equal(name, 'hello')
      t.equal(value, 'world')
    })

    function handler (field, file, filename, encoding, mimetype) {
      t.equal(filename, 'README.md')
      t.equal(field, 'upload')
      t.equal(encoding, '7bit')
      t.equal(mimetype, 'text/markdown')
      file.on('fieldsLimit', () => t.ok('field limit reached'))
      const original = fs.readFileSync(filePath, 'utf8')
      file.pipe(concat(function (buf) {
        t.equal(buf.toString(), original)
      }))
    }
  })

  fastify.listen({ port: 0 }, function () {
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

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    const rs = fs.createReadStream(filePath)
    form.append('upload', rs)
    form.append('hello', 'world')
    form.append('willbe', 'dropped')
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should call finished when both files are pumped', { skip: process.platform === 'win32' }, function (t) {
  t.plan(10)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

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

  fastify.listen({ port: 0 }, function () {
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

    const req = http.request(opts, (res) => {
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

test('should call finished if one of the streams closes prematurely', { skip: process.platform === 'win32' }, function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', function (req, reply) {
    let fileCount = 0
    t.ok(req.isMultipart())

    req.multipart(handler, function () {
      t.equal(fileCount, 1)
      reply.code(200).send()
    })

    function handler (field, file, filename, encoding, mimetype) {
      const saveTo = path.join(os.tmpdir(), path.basename(filename))
      eos(file, function () {
        fileCount++
      })

      file.on('data', function () {
        if (fileCount === 0) {
          this.destroy()
        }
      })

      pump(file, fs.createWriteStream(saveTo), () => {})
    }
  })

  fastify.listen({ port: 0 }, function () {
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

    const stream1 = fs.createReadStream(filePath)

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    form.append('upload1', stream1, {
      filename: 'random-data1'
    })
    form.append('upload2', stream1, {
      filename: 'random-data2'
    })

    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should error if it is not multipart', { skip: process.platform === 'win32' }, function (t) {
  t.plan(4)

  const fastify = Fastify()

  t.teardown(fastify.close.bind(fastify))
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

  fastify.listen({ port: 0 }, function () {
    // request
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      headers: {
        'content-type': 'application/json'
      },
      path: '/',
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
    })
    req.end(JSON.stringify({ hello: 'world' }))
  })
})

test('should error if handler is not a function', { skip: process.platform === 'win32' }, function (t) {
  t.plan(3)

  const fastify = Fastify()

  t.teardown(fastify.close.bind(fastify))
  fastify.register(multipart)

  fastify.post('/', function (req, reply) {
    const handler = null

    req.multipart(handler, function (err) {
      t.ok(err)
      reply.code(500).send()
    })
  })

  fastify.listen({ port: 0 }, function () {
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

    const req = http.request(opts, (res) => {
      res.resume()
      res.on('end', () => {
        t.equal(res.statusCode, 500)
        t.pass('res ended successfully')
      })
    })
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should error if callback is not a function', { skip: process.platform === 'win32' }, function (t) {
  t.plan(3)

  const fastify = Fastify()

  t.teardown(fastify.close.bind(fastify))
  fastify.register(multipart)

  fastify.post('/', function (req) {
    const callback = null
    req.multipart(handler, callback)

    function handler () {}
  })

  fastify.listen({ port: 0 }, function () {
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

    const req = http.request(opts, (res) => {
      res.resume()
      res.on('end', () => {
        t.equal(res.statusCode, 500)
        t.pass('res ended successfully')
      })
    })
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should error if it is invalid multipart', { skip: process.platform === 'win32' }, function (t) {
  t.plan(5)

  const fastify = Fastify()

  t.teardown(fastify.close.bind(fastify))
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

  fastify.listen({ port: 0 }, function () {
    // request
    const form = new FormData()
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      headers: {
        'content-type': 'multipart/form-data'
      },
      path: '/',
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
    })
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should override options', { skip: process.platform === 'win32' }, function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

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

  fastify.listen({ port: 0 }, function () {
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

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    const rs = fs.createReadStream(filePath)
    form.append('upload', rs)
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should not allow __proto__', { skip: process.platform === 'win32' }, function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { fields: 1 } })

  fastify.post('/', function (req, reply) {
    t.ok(req.isMultipart())

    const mp = req.multipart(handler, function (err) {
      t.equal(err.message, '__proto__ is not allowed as field name')
      reply.code(500).send()
    })

    mp.on('field', function (name, value) {
      t.fail('should not be called')
    })

    function handler (field, file, filename, encoding, mimetype) {
      t.fail('should not be called')
    }
  })

  fastify.listen({ port: 0 }, function () {
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

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    const rs = fs.createReadStream(filePath)
    form.append('__proto__', rs)
    // form.append('hello', 'world')
    // form.append('willbe', 'dropped')
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('should not allow constructor', { skip: process.platform === 'win32' }, function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { fields: 1 } })

  fastify.post('/', function (req, reply) {
    t.ok(req.isMultipart())

    const mp = req.multipart(handler, function (err) {
      t.equal(err.message, 'constructor is not allowed as field name')
      reply.code(500).send()
    })

    mp.on('field', function (name, value) {
      t.fail('should not be called')
    })

    function handler (field, file, filename, encoding, mimetype) {
      t.fail('should not be called')
    }
  })

  fastify.listen({ port: 0 }, function () {
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

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    const rs = fs.createReadStream(filePath)
    form.append('constructor', rs)
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})
