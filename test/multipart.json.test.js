'use strict'

const util = require('util')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const stream = require('stream')
const pump = util.promisify(stream.pipeline)

test('should parse JSON fields forms if content-type is set', function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    for await (const part of req.parts()) {
      t.notOk(part.filename)
      t.equal(part.mimetype, 'application/json')
      t.same(part.value, { a: 'b' })
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

    const req = http.request(opts, res => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    form.append('json', JSON.stringify({ a: 'b' }), { contentType: 'application/json' })

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should not parse JSON fields forms if no content-type is set', function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    for await (const part of req.parts()) {
      t.notOk(part.filename)
      t.notOk(part.mimetype)
      t.type(part.value, 'string')
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

    const req = http.request(opts, res => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    form.append('json', JSON.stringify({ a: 'b' }))

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should throw error when parsing JSON fields failed', function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts()) {
        t.type(part.value, 'string')
      }

      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.InvalidJSONFieldError)
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

    const req = http.request(opts, res => {
      t.equal(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    form.append('object', 'INVALID', { contentType: 'application/json' })

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should always reject JSON parsing if the value was truncated', function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { fieldSize: 2 } })

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts()) {
        t.type(part.value, 'string')
      }

      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.InvalidJSONFieldError)
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

    const req = http.request(opts, res => {
      t.equal(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    form.append('object', JSON.stringify({ a: 'b' }), { contentType: 'application/json' })

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})
