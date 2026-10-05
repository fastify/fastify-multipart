'use strict'

const util = require('node:util')
const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const concat = require('concat-stream')
const stream = require('node:stream')
const { once } = require('node:events')
const pump = util.promisify(stream.pipeline)
const streamToNull = require('../lib/stream-consumer')

const filePath = path.join(__dirname, '../README.md')

test('should parse forms', function (t, done) {
  t.plan(9)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    for await (const part of req.parts()) {
      if (part.file) {
        t.assert.strictEqual(part.type, 'file')
        t.assert.strictEqual(part.fieldname, 'upload')
        t.assert.strictEqual(part.filename, 'README.md')
        t.assert.strictEqual(part.encoding, '7bit')
        t.assert.strictEqual(part.mimetype, 'text/markdown')
        t.assert.ok(part.fields.upload)

        const original = fs.readFileSync(filePath, 'utf8')
        await pump(
          part.file,
          concat(function (buf) {
            t.assert.strictEqual(buf.toString(), original)
          })
        )
      }
    }

    reply.code(200).send()
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
      t.assert.strictEqual(res.statusCode, 200)
      // consume all data without processing
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    const rs = fs.createReadStream(filePath)
    form.append('upload', rs)
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    form.pipe(req)
  })
})

test('should respond when all files are processed', function (t, done) {
  t.plan(6)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const parts = req.files()
    for await (const part of parts) {
      t.assert.ok(part.file)
      t.assert.strictEqual(part.type, 'file')
      await streamToNull(part.file)
    }
    reply.code(200).send()
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
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    form.pipe(req)
  })
})

test('should group parts with the same name to an array', function (t, done) {
  t.plan(10)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const parts = req.parts()
    let seenUploadArray = false
    let seenHelloArray = false
    for await (const part of parts) {
      t.assert.ok(part)
      if (Array.isArray(part.fields.upload)) {
        seenUploadArray = true
      }
      if (Array.isArray(part.fields.hello)) {
        seenHelloArray = true
      }
      if (part.file) {
        await streamToNull(part.file)
      }
    }
    // Assert the grouping once, deterministically, instead of relying on the
    // variable number of times the streaming loop observes the arrays.
    t.assert.ok(seenUploadArray)
    t.assert.ok(seenHelloArray)
    reply.code(200).send()
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
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
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

test('should error if it is not multipart', function (t, done) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(!req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.InvalidMultipartContentTypeError)
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
      t.assert.strictEqual(res.statusCode, 500)
      done()
    })
    req.end(JSON.stringify({ hello: 'world' }))
  })
})

test('should error if boundary is empty', function (t, done) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.assert.strictEqual(error.message, 'Multipart: Boundary not found')
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
      headers: {
        'content-type': 'multipart/form-data'
      },
      path: '/',
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.assert.strictEqual(res.statusCode, 500)
      done()
    })

    form.pipe(req)
  })
})

test('should throw error due to filesLimit (The max number of file fields (Default: Infinity))', function (t, done) {
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      const parts = req.files({ limits: { files: 1 } })
      for await (const part of parts) {
        t.assert.ok(part.file, 'part received')
        await streamToNull(part.file)
      }
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.FilesLimitError, 'error')
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
      t.assert.strictEqual(res.statusCode, 500, 'status code')
      res.resume()
      res.on('end', () => {
        if (ended) {
          return
        }
        ended = true
        t.assert.ok('res ended successfully')
        done()
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
      t.assert.strictEqual(err.code, 'ECONNRESET')
      done()
    })
  })
})

test('should be able to configure limits globally with plugin register options', function (t, done) {
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, { limits: { files: 1 } })

  fastify.post('/', async function (req, reply) {
    try {
      const parts = req.files()
      for await (const part of parts) {
        t.assert.ok(part.file)
        t.assert.strictEqual(part.type, 'file')
        await streamToNull(part.file)
      }
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.FilesLimitError)
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
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        if (ended) {
          return
        }
        ended = true
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))
    req.on('error', (err) => {
      if (ended) {
        return
      }
      ended = true
      t.assert.strictEqual(err.code, 'ECONNRESET')
      done()
    })

    pump(form, req).catch(() => {})
  })
})

for (const { name, limits, errorCode } of [
  {
    name: 'fileSize',
    limits: { fileSize: 0 },
    errorCode: 'FST_REQ_FILE_TOO_LARGE'
  },
  {
    name: 'parts',
    limits: { parts: 0 },
    errorCode: 'FST_PARTS_LIMIT'
  }
]) {
  test(`should preserve a global zero ${name} limit`, async function (t) {
    const fastify = Fastify()
    t.after(() => fastify.close())

    await fastify.register(multipart, { limits })

    fastify.post('/', async function (req) {
      for await (const part of req.parts()) {
        if (part.file) {
          await part.toBuffer()
        }
      }
    })

    const form = new FormData()
    form.append('upload', Buffer.from('content'), { filename: 'file.txt' })

    const response = await fastify.inject({
      method: 'POST',
      url: '/',
      headers: form.getHeaders(),
      payload: form.getBuffer()
    })

    t.assert.strictEqual(response.statusCode, 413)
    t.assert.strictEqual(response.json().code, errorCode)
  })
}

test('should throw error due to fieldsLimit (Max number of non-file fields (Default: Infinity))', function (t, done) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts({ limits: { fields: 1 } })) {
        t.assert.ok(part)
      }
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.FieldsLimitError)
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
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    form.pipe(req)
  })
})

test('should throw error due to partsLimit (The max number of parts (fields + files) (Default: Infinity))', function (t, done) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts({ limits: { parts: 1 } })) {
        t.assert.ok(part)
      }
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.PartsLimitError)
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
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    form.pipe(req)
  })
})

test('should throw error due to file size limit exceed (Default: true)', function (t, done) {
  t.plan(7)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, { limits: { fileSize: 1 } })

  fastify.post('/', async function (req, reply) {
    try {
      const parts = req.files()
      for await (const part of parts) {
        t.assert.ok(part.file)
        t.assert.strictEqual(part.type, 'file')
        await streamToNull(part.file)
      }
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.RequestFileTooLargeError)
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
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))

    form.pipe(req)
  })
})

test('should not throw error due to file size limit exceed - files setting (Default: true)', function (t, done) {
  t.plan(6)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, { throwFileSizeLimit: false })

  fastify.post('/', async function (req, reply) {
    const parts = req.files({ limits: { fileSize: 1 } })
    for await (const part of parts) {
      t.assert.ok(part.file)
      t.assert.strictEqual(part.type, 'file')
      await streamToNull(part.file)
    }
    reply.code(200).send()
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
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))
    form.pipe(req)
  })
})

test('should not miss fields if part handler takes much time than formdata parsing', async function (t) {
  t.plan(12)

  const original = fs.readFileSync(filePath, 'utf8')
  const immediate = util.promisify(setImmediate)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const recvField = {
      upload: false,
      hello: false,
      willbe: false
    }

    for await (const part of req.parts()) {
      if (part.file) {
        t.assert.strictEqual(part.type, 'file')
        t.assert.strictEqual(part.fieldname, 'upload')
        t.assert.strictEqual(part.filename, 'README.md')
        t.assert.strictEqual(part.encoding, '7bit')
        t.assert.strictEqual(part.mimetype, 'text/markdown')
        t.assert.ok(part.fields.upload)

        await pump(
          part.file,
          concat(function (buf) {
            t.assert.strictEqual(buf.toString(), original)
          })
        )
        await immediate()
      }

      recvField[part.fieldname] = true
    }

    t.assert.ok(recvField.upload)
    t.assert.ok(recvField.hello)
    t.assert.ok(recvField.willbe)

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
  t.assert.strictEqual(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.assert.ok('res ended successfully')
})

test('should not freeze when error is thrown during processing', async function (t) {
  t.plan(2)
  const app = Fastify()

  app
    .register(multipart)

  app
    .post('/', async (request) => {
      const files = request.files()

      for await (const { file } of files) {
        try {
          const storage = new stream.Writable({
            write (_chunk, _encoding, callback) {
            // trigger error:
              callback(new Error('write error'))
            }
          })

          await pump(file, storage)
        } catch {}
      }

      return { message: 'done' }
    })

  await app.listen()

  const { port } = app.server.address()

  const form = new FormData()
  const opts = {
    hostname: '127.0.0.1',
    port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }
  const req = http.request(opts)

  try {
    form.append('upload', fs.createReadStream(filePath))
    form.pipe(req)
  } catch {}

  const [res] = await once(req, 'response')
  t.assert.strictEqual(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.assert.ok('res ended successfully!')

  await app.close()
})
