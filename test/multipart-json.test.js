'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')

test('should parse JSON fields forms if content-type is set', function (t, done) {
  t.plan(5)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    for await (const part of req.parts()) {
      t.assert.strictEqual(part.filename, undefined)
      t.assert.strictEqual(part.mimetype, 'application/json')
      t.assert.deepEqual(part.value, { a: 'b' })
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

    const req = http.request(opts, res => {
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })

    form.append('json', JSON.stringify({ a: 'b' }), { contentType: 'application/json' })
    form.pipe(req)
  })
})

test('should not parse JSON fields forms if no content-type is set', function (t, done) {
  t.plan(5)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    for await (const part of req.parts()) {
      t.assert.strictEqual(part.filename, undefined)
      t.assert.strictEqual(part.mimetype, 'text/plain')
      t.assert.strictEqual(typeof part.value, 'string')
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

    const req = http.request(opts, res => {
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })

    form.append('json', JSON.stringify({ a: 'b' }))

    form.pipe(req)
  })
})

test('should not parse JSON fields forms if non-json content-type is set', function (t, done) {
  t.plan(5)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    for await (const part of req.parts()) {
      t.assert.strictEqual(part.filename, undefined)
      t.assert.strictEqual(part.mimetype, 'text/css')
      t.assert.strictEqual(typeof part.value, 'string')
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

    const req = http.request(opts, res => {
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })

    form.append('css', 'body { width: 100% }', { contentType: 'text/css' })

    form.pipe(req)
  })
})

test('should throw error when parsing JSON fields failed', function (t, done) {
  t.plan(2)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts()) {
        t.assert.strictEqual(typeof part.value, 'string')
      }

      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.InvalidJSONFieldError)
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

    const req = http.request(opts, res => {
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })

    form.append('object', 'INVALID', { contentType: 'application/json' })
    form.pipe(req)
  })
})

test('should always reject JSON parsing if the value was truncated', function (t, done) {
  t.plan(2)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, { limits: { fieldSize: 2 } })

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts()) {
        t.assert.strictEqual(typeof part.value, 'string')
      }

      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.InvalidJSONFieldError)
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

    const req = http.request(opts, res => {
      t.assert.strictEqual(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })

    form.append('object', JSON.stringify({ a: 'b' }), { contentType: 'application/json' })
    form.pipe(req)
  })
})

test('should be able to use JSON schema to validate request when value is a string', function (t, done) {
  t.plan(5)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, { attachFieldsToBody: true, sharedSchemaId: '#mySharedSchema' })

  fastify.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['field'],
          properties: {
            field: {
              allOf: [{ $ref: '#mySharedSchema' }, {
                type: 'object',
                properties: { value: { type: 'string' } }
              }]
            }
          }
        }
      }
    },
    async function (req, reply) {
      t.assert.ok(req.isMultipart())

      t.assert.deepEqual(Object.keys(req.body), ['field'])
      t.assert.strictEqual(req.body.field.value, '{"a":"b"}')

      reply.code(200).send()
    }
  )

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

    const req = http.request(opts, res => {
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })

    form.append('field', JSON.stringify({ a: 'b' }))
    form.pipe(req)
  })
})

test('should be able to use JSON schema to validate request when value is a JSON', function (t, done) {
  t.plan(5)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, { attachFieldsToBody: true, sharedSchemaId: '#mySharedSchema' })

  fastify.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['field'],
          properties: {
            field: {
              allOf: [{ $ref: '#mySharedSchema' }, { type: 'object', properties: { value: { type: 'object' } } }]
            }
          }
        }
      }
    },
    async function (req, reply) {
      t.assert.ok(req.isMultipart())

      t.assert.deepEqual(Object.keys(req.body), ['field'])
      t.assert.deepEqual(req.body.field.value, { a: 'b' })

      reply.code(200).send()
    }
  )

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

    const req = http.request(opts, res => {
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })

    form.append('field', JSON.stringify({ a: 'b' }), { contentType: 'application/json' })
    form.pipe(req)
  })
})

test('should return 400 when the field validation fails', function (t, done) {
  t.plan(2)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, { attachFieldsToBody: true, sharedSchemaId: '#mySharedSchema' })

  fastify.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['field'],
          properties: {
            field: {
              allOf: [{ $ref: '#mySharedSchema' }, { type: 'object', properties: { value: { type: 'object' } } }]
            }
          }
        }
      }
    },
    async function (req, reply) {
      t.assert.ok(req.isMultipart())
      reply.code(200).send()
    }
  )

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

    const req = http.request(opts, res => {
      t.assert.strictEqual(res.statusCode, 400)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })

    form.append('field', JSON.stringify('abc'), { contentType: 'application/json' })
    form.pipe(req)
  })
})
