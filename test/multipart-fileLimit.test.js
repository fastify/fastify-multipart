'use strict'

const fs = require('node:fs')
const crypto = require('node:crypto')
const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const EventEmitter = require('node:events')
const { once } = EventEmitter

test('should throw fileSize limitation error when consuming the stream', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    throwFileSizeLimit: true,
    limits: {
      fileSize: 524288
    }
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const part = await req.file()
    t.assert.ok('the file is not consumed yet')

    try {
      await part.toBuffer()
      t.assert.fail('it should throw')
    } catch (error) {
      t.assert.ok(error)
      reply.send(error)
    }
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

  const randomFileBuffer = Buffer.alloc(600_000)
  crypto.randomFillSync(randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', randomFileBuffer)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 413)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.assert.ifError(error)
  }
})

test('should throw fileSize limitation error when consuming the stream MBs', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    throwFileSizeLimit: true,
    limits: {
      fileSize: 5_000_000 // 5MB
    }
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const part = await req.file()
    t.assert.ok('the file is not consumed yet')

    try {
      await part.toBuffer()
      t.assert.fail('it should throw')
    } catch (error) {
      t.assert.ok(error)
      reply.send(error)
    }
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

  const tmpFile = 'test/random-file'
  fs.writeFileSync(tmpFile, randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', fs.createReadStream(tmpFile))

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 413)
    res.resume()
    await once(res, 'end')

    fs.unlinkSync(tmpFile)
  } catch (error) {
    t.assert.ifError(error)
  }
})

test('should NOT throw fileSize limitation error when consuming the stream', async function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      fileSize: 524288
    }
  })
  const fileInputLength = 600000

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const part = await req.file()
    t.assert.ok('the file is not consumed yet')

    try {
      const buffer = await part.toBuffer()
      t.assert.ok(part.file.truncated)
      t.assert.notStrictEqual(buffer.length, fileInputLength)
      reply.send(new fastify.multipartErrors.FilesLimitError())
    } catch {
      t.assert.fail('it should not throw')
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

  const randomFileBuffer = Buffer.alloc(fileInputLength)
  crypto.randomFillSync(randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', randomFileBuffer)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 413)
    res.resume()
  } catch (error) {
    t.assert.ifError(error)
  }
})

// testing per-request override by using above tests as reference
test('should throw fileSize limitation error when throwFileSizeLimit is globally set to false but is set to true in request opts', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      fileSize: 1_000_000
    }
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const part = await req.file({
      throwFileSizeLimit: true,
      limits: {
        fileSize: 524288
      }
    })
    t.assert.ok('the file is not consumed yet')

    try {
      await part.toBuffer()
      t.assert.fail('it should throw')
    } catch (error) {
      t.assert.ok(error)
      reply.send(error)
    }
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

  const randomFileBuffer = Buffer.alloc(600_000)
  crypto.randomFillSync(randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', randomFileBuffer)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 413)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.assert.ifError(error)
  }
})

test('should NOT throw fileSize limitation error when throwFileSizeLimit is globally set to true but is set to false in request opts', async function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    throwFileSizeLimit: true,
    limits: {
      fileSize: 524288
    }
  })
  const fileInputLength = 600_000

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const part = await req.file({
      throwFileSizeLimit: false
    })
    t.assert.ok('the file is not consumed yet')

    try {
      const buffer = await part.toBuffer()
      t.assert.ok(part.file.truncated)
      t.assert.notStrictEqual(buffer.length, fileInputLength)
      reply.send(new fastify.multipartErrors.FilesLimitError())
    } catch {
      t.assert.fail('it should not throw')
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

  const randomFileBuffer = Buffer.alloc(fileInputLength)
  crypto.randomFillSync(randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', randomFileBuffer)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.assert.strictEqual(res.statusCode, 413)
    res.resume()
  } catch (error) {
    t.assert.ifError(error)
  }
})

test('should throw fileSize limitation error when used alongside attachFieldsToBody and set request config', async function (t) {
  t.plan(1)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, {
    attachFieldsToBody: true
  })

  const randomFileBuffer = Buffer.alloc(2_000_000)
  crypto.randomFillSync(randomFileBuffer)

  fastify.post('/', {
    config: {
      multipartOptions: {
        limits: {
          fileSize: 1_000_000
        }
      }
    }
  }, async function (req, reply) {
    t.fail('it should throw')

    reply.status(200).send()
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

  const tmpFile = 'test/random-file'
  fs.writeFileSync(tmpFile, randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', fs.createReadStream(tmpFile))

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 413)
    res.resume()
    await once(res, 'end')

    fs.unlinkSync(tmpFile)
  } catch (error) {
    t.error(error, 'request')
  }
})

test('should not throw fileSize limitation error when used alongside attachFieldsToBody and set request config', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, {
    attachFieldsToBody: true
  })

  const randomFileBuffer = Buffer.alloc(900_000)
  crypto.randomFillSync(randomFileBuffer)

  fastify.post('/', {
    config: {
      multipartOptions: {
        limits: {
          fileSize: 1_000_000
        }
      }
    }
  }, async function (req, reply) {
    t.ok(req.isMultipart())

    t.same(Object.keys(req.body), ['upload'])

    const content = await req.body.upload.toBuffer()

    t.equal(content.toString(), randomFileBuffer.toString())

    reply.status(200).send()
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

  const tmpFile = 'test/random-file'
  fs.writeFileSync(tmpFile, randomFileBuffer)

  const req = http.request(opts)
  form.append('upload', fs.createReadStream(tmpFile))

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 200)
    res.resume()
    await once(res, 'end')

    fs.unlinkSync(tmpFile)
  } catch (error) {
    t.error(error, 'request')
  }
})
