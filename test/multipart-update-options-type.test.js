'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const EventEmitter = require('node:events')
const { once } = EventEmitter

test('Should throw RequestFileTooLargeError when throwFileSizeLimit: true for file())', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      const file = await req.file({ limits: { fileSize: 1 }, throwFileSizeLimit: true })
      await file.toBuffer()
      t.assert.fail('should throw')
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.RequestFileTooLargeError)
      reply.code(500).send()
    }
  })

  await fastify.listen({ port: 0 })
  // request
  const form = new FormData()
  const opts = {
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const randomFileBuffer = Buffer.alloc(1 * 1024 * 1024)

  const req = http.request(opts)

  form.append('upload', randomFileBuffer)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 500)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.assert.ifError(error)
  }
})

test('Should NOT throw RequestFileTooLargeError when throwFileSizeLimit: false for file())', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      const file = await req.file({ limits: { fileSize: 1 }, throwFileSizeLimit: false })
      await file.toBuffer()
      t.assert.ok('OK')
      reply.code(200).send()
    } catch {
      t.assert.fail('Should not throw')
      reply.code(500).send()
    }
  })

  await fastify.listen({ port: 0 })
  // request
  const form = new FormData()
  const opts = {
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const randomFileBuffer = Buffer.alloc(1 * 1024 * 1024)

  const req = http.request(opts)

  form.append('upload', randomFileBuffer)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 200)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.assert.ifError(error)
  }
})

test('Should throw RequestFileTooLargeError when throwFileSizeLimit: true for files())', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      const files = req.files({ limits: { fileSize: 1 }, throwFileSizeLimit: true })
      for await (const file of files) {
        await file.toBuffer()
      }
      t.assert.fail('Should throw')
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.RequestFileTooLargeError)
      reply.code(500).send()
    }
  })

  await fastify.listen({ port: 0 })
  // request
  const form = new FormData()
  const opts = {
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const randomFileBuffer = Buffer.alloc(1 * 1024 * 1024)

  const req = http.request(opts)

  form.append('upload', randomFileBuffer)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 500)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.assert.ifError(error)
  }
})

test('Should NOT throw RequestFileTooLargeError when throwFileSizeLimit: false for files())', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      const files = req.files({ limits: { fileSize: 1 }, throwFileSizeLimit: false })
      for await (const file of files) {
        await file.toBuffer()
      }
      t.assert.ok('OK')
      reply.code(200).send()
    } catch {
      t.assert.fail('Should not throw')
      reply.code(500).send()
    }
  })

  await fastify.listen({ port: 0 })
  // request
  const form = new FormData()
  const opts = {
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const randomFileBuffer = Buffer.alloc(1 * 1024 * 1024)

  const req = http.request(opts)

  form.append('upload', randomFileBuffer)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 200)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.assert.ifError(error)
  }
})
