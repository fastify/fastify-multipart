'use strict'

const util = require('util')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const stream = require('stream')
const { once } = require('events')
const pump = util.promisify(stream.pipeline)

const filePath = path.join(__dirname, '../README.md')

test('should be able to attach all parsed fields and files and make it accessible through "req.body"', async function (t) {
  t.plan(6)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { attachFieldsToBody: true })

  const original = fs.readFileSync(filePath, 'utf8')

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    t.same(Object.keys(req.body), ['upload', 'hello'])

    const content = await req.body.upload.toBuffer()

    t.equal(content.toString(), original)
    t.equal(req.body.hello.value, 'world')

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
  form.append('upload', fs.createReadStream(filePath))
  form.append('hello', 'world')

  try {
    await pump(form, req)
  } catch (error) {
    t.error(error, 'formData request pump: no err')
  }

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.pass('res ended successfully')
})

test('should be able to define a custom "onFile" handler', async function (t) {
  t.plan(7)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  async function onFile (part) {
    t.pass('custom onFile handler')
    await part.toBuffer()
  }

  fastify.register(multipart, { attachFieldsToBody: true, onFile })

  const original = fs.readFileSync(filePath, 'utf8')

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    t.same(Object.keys(req.body), ['upload', 'hello'])

    const content = await req.body.upload.toBuffer()

    t.equal(content.toString(), original)
    t.equal(req.body.hello.value, 'world')

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
  form.append('upload', fs.createReadStream(filePath))
  form.append('hello', 'world')

  try {
    await pump(form, req)
  } catch (error) {
    t.error(error, 'formData request pump: no err')
  }

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.pass('res ended successfully')
})

test('should not process requests with content-type other than multipart', function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { attachFieldsToBody: true })

  fastify.post('/', async function (req) {
    return { hello: req.body.name }
  })

  fastify.listen({ port: 0 }, function () {
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    }
    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.on('data', function (data) {
        t.equal(JSON.parse(data).hello, 'world')
      })
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    req.end(JSON.stringify({ name: 'world' }))
  })
})
