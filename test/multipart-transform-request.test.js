'use strict'

const test = require('node:test')
const { Transform } = require('node:stream')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')

const boundary = '----TestBoundary'
const payload = Buffer.from(
  `--${boundary}\r\n` +
  'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n' +
  'Content-Type: text/plain\r\n' +
  '\r\n' +
  'test content\r\n' +
  `--${boundary}--\r\n`
)

test('should transformRequest called when option passed', function (t, done) {
  t.plan(4)

  let transformRequestCalled = false
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    transformRequest: (request) => {
      transformRequestCalled = true
      return request
    }
  })

  fastify.post('/', async function (req, reply) {
    const file = await req.file()
    t.assert.strictEqual(file.filename, 'test.txt')
    const content = await file.toBuffer()
    t.assert.strictEqual(content.toString(), 'test content')

    t.assert.ok(transformRequestCalled, 'transformRequest should have been called')
    reply.code(200).send()
  })

  fastify.listen({ port: 0 }, function () {
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        done()
      })
    })

    req.end(payload)
  })
})

test('should transform the request stream', function (t, done) {
  t.plan(3)
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    transformRequest: (request) => {
      // custom transfrom function to change content to uppercase
      const upperCaseTr = new Transform({
        transform (chunk, encoding, callback) {
          callback(null, chunk.toString().toUpperCase())
        }
      })
      return request.pipe(upperCaseTr)
    }
  })

  fastify.post('/', async (req) => {
    const file = await req.file()
    t.assert.strictEqual(file.filename, 'TEST.TXT')

    const content = await file.toBuffer()
    t.assert.strictEqual(content.toString().trim(), 'TEST CONTENT')

    return { ok: true }
  })

  fastify.listen({ port: 0 }, () => {
    const req = http.request({
      port: fastify.server.address().port,
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary.toUpperCase()}` }
    }, (res) => {
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', done)
    })
    req.end(payload)
  })
})

test('should handle transformRequest throwing an error', function (t, done) {
  t.plan(2)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    transformRequest: (request) => {
      throw new Error('transformRequest failed')
    }
  })

  fastify.post('/', async function (req, reply) {
    const file = await req.file()
    await file.toBuffer()
    reply.code(200).send()
  })

  fastify.listen({ port: 0 }, function () {
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
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

    req.end(payload)
  })
})

test('should throw transformRequest returning undefined', function (t, done) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    transformRequest: (request) => {
      return undefined
    }
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      const file = await req.file()
      await file.toBuffer()
      reply.code(200).send()
    } catch (error) {
      t.assert.strictEqual(error.code, 'FST_INVALID_TRANSFORM_REQUEST')
      reply.code(500).send()
    }
  })

  fastify.listen({ port: 0 }, function () {
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', done)
    })

    req.end(payload)
  })
})

test('should throw transformRequest returning null', function (t, done) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    transformRequest: (request) => {
      return null
    }
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      const file = await req.file()
      await file.toBuffer()
      reply.code(200).send()
    } catch (error) {
      t.assert.strictEqual(error.code, 'FST_INVALID_TRANSFORM_REQUEST')
      reply.code(500).send()
    }
  })

  fastify.listen({ port: 0 }, function () {
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', done)
    })

    req.end(payload)
  })
})

test('should throw transformRequest returning non-streaming data', function (t, done) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    transformRequest: (request) => {
      return 'non-streaming data'
    }
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      const file = await req.file()
      await file.toBuffer()
      reply.code(200).send()
    } catch (error) {
      t.assert.strictEqual(error.code, 'FST_INVALID_TRANSFORM_REQUEST')
      reply.code(500).send()
    }
  })

  fastify.listen({ port: 0 }, function () {
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', done)
    })

    req.end(payload)
  })
})

test('should handle transformed stream closing prematurely', function (t, done) {
  t.plan(3)

  const largeContent = Buffer.alloc(1024, 'x').toString()
  const largePayload = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file"; filename="large.txt"\r\n' +
    'Content-Type: text/plain\r\n' +
    '\r\n' +
    largeContent + '\r\n' +
    `--${boundary}--\r\n`
  )

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    transformRequest: (request) => {
      const prematureStream = new Transform({
        transform (chunk, encoding, callback) {
          process.nextTick(() => this.destroy())
          callback(null, chunk)
        }
      })
      return request.pipe(prematureStream)
    }
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      const file = await req.file()
      await file.toBuffer()
      reply.code(200).send()
    } catch (error) {
      t.assert.strictEqual(error.code, 'ERR_STREAM_PREMATURE_CLOSE')
      reply.code(500).send()
    }
  })

  fastify.listen({ port: 0 }, function () {
    let finished = false
    const safeDone = () => {
      if (!finished) {
        finished = true
        done()
      }
    }

    const req = http.request({
      port: fastify.server.address().port,
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }
    }, (res) => {
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', done)
    })

    req.on('error', (err) => {
      if (!finished) {
        t.assert.ok(err.message.includes('EPIPE') || err.message.includes('reset'))
        safeDone()
      }
    })

    req.end(largePayload)
  })
})

test('should handle transformed stream emitting an error during processing', function (t, done) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    transformRequest: (request) => {
      const errStream = new Transform({
        transform (chunk, encoding, callback) {
          callback(new Error('stream processing failed'))
        }
      })
      return request.pipe(errStream)
    }
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      const file = await req.file()
      await file.toBuffer()
      reply.code(200).send()
    } catch (error) {
      t.assert.strictEqual(error.message, 'stream processing failed')
      reply.code(500).send()
    }
  })

  fastify.listen({ port: 0 }, function () {
    const req = http.request({
      port: fastify.server.address().port,
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }
    }, (res) => {
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', done)
    })

    req.end(payload)
  })
})
