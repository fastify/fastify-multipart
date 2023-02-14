'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const EventEmitter = require('events')
const { once } = EventEmitter

const filePath = path.join(__dirname, '../README.md')

test('should not allow __proto__ as file name', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.PrototypeViolationError)
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

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    const rs = fs.createReadStream(filePath)
    form.append('__proto__', rs)

    form.pipe(req)
  })
})

test('should not allow __proto__ as field name', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart(), 'first')

    try {
      await req.file()
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.PrototypeViolationError, 'correct error')
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

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    form.append('__proto__', 'world')

    form.pipe(req)
  })
})

test('should use default for fileSize', async function (t) {
  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, {
    throwFileSizeLimit: true
  })

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const part = await req.file()
    t.pass('the file is not consumed yet')

    try {
      await part.toBuffer()
      reply.send('not ok')
      t.fail('it should throw')
    } catch (error) {
      t.ok(error)
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

  const randomFileBuffer = Buffer.alloc(15000000)
  crypto.randomFillSync(randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', randomFileBuffer)

  form.pipe(req)
  req.on('error', () => {})

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 413)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error)
  }
})

test('should use default for parts - 1000', async function (t) {
  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      // eslint-disable-next-lint no-empty
      for await (const _ of req.parts()) { console.assert(_) }
      t.fail('should throw on 1001')
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.PartsLimitError)
      reply.code(500).send()
    }
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

  const req = http.request(opts, (res) => {
    t.equal(res.statusCode, 500)
    res.resume()
    res.on('end', () => {
      t.pass('res ended successfully')
      t.end()
    })
  })
  for (let i = 0; i < 1000; ++i) {
    form.append('hello' + i, 'world')
  }
  // Exceeds the default limit (1000)
  form.append('hello', 'world')

  form.pipe(req)
  await once(req, 'close')
})
