'use strict'

const util = require('util')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const concat = require('concat-stream')
const stream = require('stream')
const pump = util.promisify(stream.pipeline)
const sendToWormhole = require('stream-wormhole')

const filePath = path.join(__dirname, '../README.md')

test('should parse forms', function (t) {
  t.plan(8)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    for await (const part of req.parts()) {
      if (part.file) {
        t.equal(part.fieldname, 'upload')
        t.equal(part.filename, 'README.md')
        t.equal(part.encoding, '7bit')
        t.equal(part.mimetype, 'text/markdown')
        t.ok(part.fields.upload)

        const original = fs.readFileSync(filePath, 'utf8')
        await pump(
          part.file,
          concat(function (buf) {
            t.equal(buf.toString(), original)
          })
        )
      }
    }

    reply.code(200).send()
  })

  fastify.listen(0, async function () {
    // request
    const form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      // consume all data without processing
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    const rs = fs.createReadStream(filePath)
    form.append('upload', rs)
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should respond when all files are processed', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const parts = await req.files()
    for await (const part of parts) {
      t.ok(part.file)
      await sendToWormhole(part.file)
    }
    reply.code(200).send()
  })

  fastify.listen(0, async function () {
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

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should group parts with the same name to an array', function (t) {
  t.plan(15)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const parts = await req.parts()
    for await (const part of parts) {
      t.ok(part)
      if (Array.isArray(part.fields.upload)) {
        t.pass('multiple fields are grouped by array')
      }
      if (Array.isArray(part.fields.hello)) {
        t.pass('multiple files are grouped by array')
      }
      if (part.file) {
        await sendToWormhole(part.file)
      }
    }
    reply.code(200).send()
  })

  fastify.listen(0, async function () {
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
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload', fs.createReadStream(filePath))
    form.append('hello', 'world')
    form.append('hello', 'foo')
    form.append('hello', 'bar')

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should error if it is not multipart', function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.notOk(req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.true(error instanceof fastify.multipartErrors.InvalidMultipartContentTypeError)
      reply.code(500).send()
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

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
    })
    req.end(JSON.stringify({ hello: 'world' }))
  })
})

test('should error if boundary is empty', function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.equal(error.message, 'Multipart: Boundary not found')
      reply.code(500).send()
    }
  })

  fastify.listen(0, async function () {
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

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should throw error due to filesLimit (The max number of file fields (Default: Infinity))', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      const parts = await req.files({ limits: { files: 1 } })
      for await (const part of parts) {
        t.ok(part.file)
        await sendToWormhole(part.file)
      }
      reply.code(200).send()
    } catch (error) {
      t.true(error instanceof fastify.multipartErrors.FilesLimitError)
      reply.code(500).send()
    }
  })

  fastify.listen(0, async function () {
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
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should be able to configure limits globally with plugin register options', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { files: 1 } })

  fastify.post('/', async function (req, reply) {
    try {
      const parts = await req.files()
      for await (const part of parts) {
        t.ok(part.file)
        await sendToWormhole(part.file)
      }
      reply.code(200).send()
    } catch (error) {
      t.true(error instanceof fastify.multipartErrors.FilesLimitError)
      reply.code(500).send()
    }
  })

  fastify.listen(0, async function () {
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
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should throw error due to fieldsLimit (Max number of non-file fields (Default: Infinity))', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts({ limits: { fields: 1 } })) {
        t.ok(part)
      }
      reply.code(200).send()
    } catch (error) {
      t.true(error instanceof fastify.multipartErrors.FieldsLimitError)
      reply.code(500).send()
    }
  })

  fastify.listen(0, async function () {
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
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should throw error due to partsLimit (The max number of parts (fields + files) (Default: Infinity))', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts({ limits: { parts: 1 } })) {
        t.ok(part)
      }
      reply.code(200).send()
    } catch (error) {
      t.true(error instanceof fastify.multipartErrors.PartsLimitError)
      reply.code(500).send()
    }
  })

  fastify.listen(0, async function () {
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
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should also work with multipartIterator', function (t) {
  t.plan(8)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    for await (const part of req.multipartIterator()) {
      if (part.file) {
        t.equal(part.fieldname, 'upload')
        t.equal(part.filename, 'README.md')
        t.equal(part.encoding, '7bit')
        t.equal(part.mimetype, 'text/markdown')
        t.ok(part.fields.upload)

        const original = fs.readFileSync(filePath, 'utf8')
        await pump(
          part.file,
          concat(function (buf) {
            t.equal(buf.toString(), original)
          })
        )
      }
    }

    reply.code(200).send()
  })

  fastify.listen(0, async function () {
    // request
    const form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      // consume all data without processing
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    const rs = fs.createReadStream(filePath)
    form.append('upload', rs)
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should receive all field', function (t) {
  t.plan(11)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const recvField = {
      upload: false,
      hello: false,
      willbe: false
    }

    for await (const part of req.parts()) {
      recvField[part.fieldname] = true
      if (part.file) {
        t.equal(part.fieldname, 'upload')
        t.equal(part.filename, 'README.md')
        t.equal(part.encoding, '7bit')
        t.equal(part.mimetype, 'text/markdown')
        t.ok(part.fields.upload)

        const original = fs.readFileSync(filePath, 'utf8')
        await pump(
          part.file,
          concat(function (buf) {
            t.equal(buf.toString(), original)
          })
        )
        // wait for 1s to mimic situation that user side takes a long time to process every part
        await new Promise((resolve, reject) => {
          setTimeout(resolve, 1000)
        })
      }
    }

    t.equal(recvField.upload, true)
    t.equal(recvField.hello, true)
    t.equal(recvField.willbe, true)

    reply.code(200).send()
  })

  fastify.listen(0, async function () {
    // request
    const form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      // consume all data without processing
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    const rs = fs.createReadStream(filePath)
    form.append('upload', rs)
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})
