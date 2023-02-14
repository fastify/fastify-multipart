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
const { once } = require('events')
const pump = util.promisify(stream.pipeline)
const sendToWormhole = require('stream-wormhole')

const filePath = path.join(__dirname, '../README.md')

test('should parse forms', function (t) {
  t.plan(8)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

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

  fastify.listen({ port: 0 }, async function () {
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

    form.pipe(req)
  })
})

test('should respond when all files are processed', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const parts = req.files()
    for await (const part of parts) {
      t.ok(part.file)
      await sendToWormhole(part.file)
    }
    reply.code(200).send()
  })

  fastify.listen({ port: 0 }, async function () {
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

    form.pipe(req)
  })
})

test('should group parts with the same name to an array', function (t) {
  t.plan(15)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const parts = req.parts()
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

  fastify.listen({ port: 0 }, async function () {
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

    form.pipe(req)
  })
})

test('should error if it is not multipart', function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.notOk(req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.InvalidMultipartContentTypeError)
      reply.code(500).send()
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

test('should error if boundary is empty', function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

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

  fastify.listen({ port: 0 }, async function () {
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

    form.pipe(req)
  })
})

test('should throw error due to filesLimit (The max number of file fields (Default: Infinity))', function (t) {
  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      const parts = req.files({ limits: { files: 1 } })
      for await (const part of parts) {
        t.ok(part.file, 'part received')
        await sendToWormhole(part.file)
      }
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.FilesLimitError, 'error')
      reply.code(500).send()
    }
  })

  fastify.listen({ port: 0 }, async function () {
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

    let ended = false
    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500, 'status code')
      res.resume()
      res.on('end', () => {
        if (ended) {
          return
        }
        ended = true
        t.pass('res ended successfully')
        t.end()
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))
    form.pipe(req)
    req.on('error', (err) => {
      if (ended) {
        return
      }
      ended = true
      t.equal(err.code, 'ECONNRESET')
      t.end()
    })
  })
})

test('should be able to configure limits globally with plugin register options', function (t) {
  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { files: 1 } })

  fastify.post('/', async function (req, reply) {
    try {
      const parts = req.files()
      for await (const part of parts) {
        t.ok(part.file)
        await sendToWormhole(part.file)
      }
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.FilesLimitError)
      reply.code(500).send()
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

    let ended = false
    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        if (ended) {
          return
        }
        ended = true
        t.pass('res ended successfully')
        t.end()
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))
    req.on('error', (err) => {
      if (ended) {
        return
      }
      ended = true
      t.equal(err.code, 'ECONNRESET')
      t.end()
    })

    pump(form, req).catch(() => {})
  })
})

test('should throw error due to fieldsLimit (Max number of non-file fields (Default: Infinity))', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts({ limits: { fields: 1 } })) {
        t.ok(part)
      }
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.FieldsLimitError)
      reply.code(500).send()
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
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    form.pipe(req)
  })
})

test('should throw error due to partsLimit (The max number of parts (fields + files) (Default: Infinity))', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts({ limits: { parts: 1 } })) {
        t.ok(part)
      }
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.PartsLimitError)
      reply.code(500).send()
    }
  })

  fastify.listen({ port: 0 }, async function () {
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

    form.pipe(req)
  })
})

test('should throw error due to file size limit exceed (Default: true)', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { fileSize: 1 } })

  fastify.post('/', async function (req, reply) {
    try {
      const parts = req.files()
      for await (const part of parts) {
        t.ok(part.file)
        await sendToWormhole(part.file)
      }
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.RequestFileTooLargeError)
      reply.code(500).send()
    }
  })

  fastify.listen({ port: 0 }, async function () {
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
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))

    form.pipe(req)
  })
})

test('should not throw error due to file size limit exceed - files setting (Default: true)', function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { throwFileSizeLimit: false })

  fastify.post('/', async function (req, reply) {
    const parts = req.files({ limits: { fileSize: 1 } })
    for await (const part of parts) {
      t.ok(part.file)
      await sendToWormhole(part.file)
    }
    reply.code(200).send()
  })

  fastify.listen({ port: 0 }, async function () {
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
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))
    form.pipe(req)
  })
})

test('should not miss fields if part handler takes much time than formdata parsing', async function (t) {
  t.plan(11)

  const original = fs.readFileSync(filePath, 'utf8')
  const immediate = util.promisify(setImmediate)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const recvField = {
      upload: false,
      hello: false,
      willbe: false
    }

    for await (const part of req.parts()) {
      if (part.file) {
        t.equal(part.fieldname, 'upload')
        t.equal(part.filename, 'README.md')
        t.equal(part.encoding, '7bit')
        t.equal(part.mimetype, 'text/markdown')
        t.ok(part.fields.upload)

        await pump(
          part.file,
          concat(function (buf) {
            t.equal(buf.toString(), original)
          })
        )
        await immediate()
      }

      recvField[part.fieldname] = true
    }

    t.equal(recvField.upload, true)
    t.equal(recvField.hello, true)
    t.equal(recvField.willbe, true)

    reply.code(200).send()
  })

  await fastify.listen({ port: 0 })

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

  const req = http.request(opts)
  const rs = fs.createReadStream(filePath)
  form.append('upload', rs)
  form.append('hello', 'world')
  form.append('willbe', 'dropped')

  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.pass('res ended successfully')
})
