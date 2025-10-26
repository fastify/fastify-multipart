'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const { once } = require('node:events')

test('should not break with a empty request body when attachFieldsToBody is true', async function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, { attachFieldsToBody: true })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const files = await req.saveRequestFiles()

    t.assert.ok(Array.isArray(files))
    t.assert.strictEqual(files.length, 0)

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
  form.pipe(req)

  const [res] = await once(req, 'response')
  t.assert.strictEqual(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.assert.ok('res ended successfully')
})

test('should not break with a empty request body when attachFieldsToBody is keyValues', async function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, { attachFieldsToBody: 'keyValues' })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const files = await req.saveRequestFiles()

    t.assert.ok(Array.isArray(files))
    t.assert.strictEqual(files.length, 0)

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
  form.pipe(req)

  const [res] = await once(req, 'response')
  t.assert.strictEqual(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.assert.ok('res ended successfully')
})
