'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const EventEmitter = require('node:events')
const { once } = EventEmitter

const filePath = path.join(__dirname, '../README.md')

test('should not allow __proto__ as file name', function (t, done) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.PrototypeViolationError)
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
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    const rs = fs.createReadStream(filePath)
    form.append('__proto__', rs)

    form.pipe(req)
  })
})

test('should not allow __proto__ as field name', function (t, done) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.PrototypeViolationError)
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
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('__proto__', 'world')

    form.pipe(req)
  })
})

test('should not allow toString as field name', function (t, done) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.PrototypeViolationError)
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
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('toString', 'world')

    form.pipe(req)
  })
})

test('should not allow hasOwnProperty as field name', function (t, done) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.PrototypeViolationError)
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
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('hasOwnProperty', 'world')

    form.pipe(req)
  })
})

test('should not allow propertyIsEnumerable as field name', function (t, done) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.PrototypeViolationError)
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
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('propertyIsEnumerable', 'world')

    form.pipe(req)
  })
})

test('should use default for fileSize', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    throwFileSizeLimit: true
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart(), 'is multipart')

    const part = await req.file()
    t.assert.ok('the file is not consumed yet')

    try {
      await part.toBuffer()
      reply.send('not ok')
      t.assert.fail('it should throw')
    } catch (error) {
      t.assert.ok(error)
      reply.send(error)
    }
    return reply
  })

  await fastify.listen({ port: 0 })

  // request
  const form = new FormData()
  const opts = {
    hostname: '127.0.0.1',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const randomFileBuffer = Buffer.alloc(15_000_000)
  crypto.randomFillSync(randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', randomFileBuffer)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 413, 'status code equal')
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.assert.ifError(error)
  }
})

test('should use default for parts - 1000', function (t, done) {
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      // eslint-disable-next-lint no-empty
      for await (const _ of req.parts()) { console.assert(_) }
      t.assert.fail('should throw on 1001')
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.PartsLimitError)
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
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    for (let i = 0; i < 1000; ++i) {
      form.append('hello' + i, 'world')
    }
    // Exceeds the default limit (1000)
    form.append('hello', 'world')

    form.pipe(req)
  })
})
