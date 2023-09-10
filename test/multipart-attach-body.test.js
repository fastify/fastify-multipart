'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const { once } = require('node:events')
const { Readable } = require('node:stream')
const pump = require('pump')
const { writableNoopStream } = require('noop-stream')

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
  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.pass('res ended successfully')
})

test('should be able to attach all parsed field values and json content files and make it accessible through "req.body"', async function (t) {
  t.plan(6)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { attachFieldsToBody: 'keyValues' })

  const original = { testContent: 'test upload content' }

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    t.same(Object.keys(req.body), ['upload', 'hello'])

    t.same(req.body.upload, original)
    t.equal(req.body.hello, 'world')

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
  form.append('upload', Readable.from(Buffer.from(JSON.stringify(original))), { contentType: 'application/json' })
  form.append('hello', 'world')
  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.pass('res ended successfully')
})

test('should be able to attach all parsed field values and files and make it accessible through "req.body"', async function (t) {
  t.plan(6)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { attachFieldsToBody: 'keyValues' })

  const original = fs.readFileSync(filePath, 'utf8')

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    t.same(Object.keys(req.body), ['upload', 'hello'])

    t.equal(req.body.upload, original)
    t.equal(req.body.hello, 'world')

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
  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.pass('res ended successfully')
})

test('should be able to attach all parsed field values and files with custom "onFile" handler and make it accessible through "req.body"', async function (t) {
  t.plan(7)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  async function onFile (part) {
    t.pass('custom onFile handler')
    const buff = await part.toBuffer()
    const decoded = Buffer.from(buff.toString(), 'base64').toString()
    part.value = decoded
  }

  fastify.register(multipart, { attachFieldsToBody: 'keyValues', onFile })

  const original = 'test upload content'

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())
    t.same(Object.keys(req.body), ['upload', 'hello'])

    t.equal(req.body.upload, original)
    t.equal(req.body.hello, 'world')

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
  form.append('upload', Readable.from(Buffer.from(original).toString('base64')))
  form.append('hello', 'world')
  form.pipe(req)

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
  form.pipe(req)

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

test('should manage array fields', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { attachFieldsToBody: 'keyValues' })

  const original = fs.readFileSync(filePath, 'utf8')

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    t.same(req.body, {
      upload: [original, original],
      hello: ['hello', 'world']
    })

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
  form.append('upload', Readable.from(Buffer.from(JSON.stringify(original))), { contentType: 'application/json' })
  form.append('upload', fs.createReadStream(filePath))
  form.append('hello', 'hello')
  form.append('hello', 'world')
  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.pass('res ended successfully')
})

test('should be able to attach all parsed field values and files with custom "onFile" handler with access to request object bind to "this"', async function (t) {
  t.plan(6)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  async function onFile (part) {
    t.pass('custom onFile handler')
    t.equal(this.id, 'req-1')
    t.equal(typeof this, 'object')
    const buff = await part.toBuffer()
    const decoded = Buffer.from(buff.toString(), 'base64').toString()
    part.value = decoded
  }

  fastify.register(multipart, { attachFieldsToBody: 'keyValues', onFile })

  const original = 'test upload content'

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())
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
  form.append('upload', Readable.from(Buffer.from(original).toString('base64')))
  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.pass('res ended successfully')
})

test('should handle file stream consumption when internal buffer is not yet loaded', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  async function onFile (part) {
    pump(part.file, writableNoopStream()).once('end', () => {
      t.pass('stream consumed successfully')
    })
  }

  fastify.register(multipart, { attachFieldsToBody: 'keyValues', onFile })

  const original = 'test upload content'

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())
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
  form.append('upload', Readable.from(Buffer.from(original).toString('base64')))
  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  t.pass('res ended successfully')
})
