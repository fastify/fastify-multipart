'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const crypto = require('crypto')
const { Readable } = require('stream')
const path = require('path')
const fs = require('fs')
const { access } = require('fs').promises
const EventEmitter = require('events')
const { once } = EventEmitter

const filePath = path.join(__dirname, '../README.md')

test('should store file on disk, remove on response', async function (t) {
  t.plan(10)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const files = await req.saveRequestFiles()

    t.ok(files[0].filepath)
    t.equal(files[0].fieldname, 'upload')
    t.equal(files[0].filename, 'README.md')
    t.equal(files[0].encoding, '7bit')
    t.equal(files[0].mimetype, 'text/markdown')
    t.ok(files[0].fields.upload)

    await access(files[0].filepath, fs.constants.F_OK)

    reply.code(200).send()
  })
  const ee = new EventEmitter()

  // ensure that file is removed after response
  fastify.addHook('onResponse', async (request, reply) => {
    try {
      await access(request.tmpUploads[0], fs.constants.F_OK)
    } catch (error) {
      t.equal(error.code, 'ENOENT')
      t.pass('Temp file was removed after response')
      ee.emit('response')
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

  const req = http.request(opts)
  form.append('upload', fs.createReadStream(filePath))

  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  await once(ee, 'response')
})

test('should store file on disk, remove on response error', async function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    await req.saveRequestFiles()

    throw new Error('test')
  })

  const ee = new EventEmitter()

  // ensure that file is removed after response
  fastify.addHook('onResponse', async (request, reply) => {
    try {
      await access(request.tmpUploads[0], fs.constants.F_OK)
    } catch (error) {
      t.equal(error.code, 'ENOENT')
      t.pass('Temp file was removed after response')
      ee.emit('response')
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
    })
  })
  form.append('upload', fs.createReadStream(filePath))

  try {
    await form.pipe(req)
  } catch (error) {
    t.error(error, 'formData request pump: no err')
  }
  await once(ee, 'response')
})

test('should throw on file limit error', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      await req.saveRequestFiles({ limits: { fileSize: 500 } })
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.RequestFileTooLargeError)
      t.equal(error.part.fieldname, 'upload')
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
  const req = http.request(opts)
  form.append('upload', fs.createReadStream(filePath))

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 500)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error, 'request')
  }
})

test('should throw on file save error', async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(require('..'))

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      await req.saveRequestFiles({ tmpdir: 'something' })
      reply.code(200).send()
    } catch (error) {
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
  const req = http.request(opts)
  const readStream = fs.createReadStream(filePath)
  form.append('upload', readStream)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 500)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error, 'request')
  }
})

test('should not throw on request files cleanup error', { skip: process.platform === 'win32' }, async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(require('..'))

  const tmpdir = t.testdir()

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      await req.saveRequestFiles({ tmpdir })
      // temp file saved, remove before the onResponse hook
      await fs.promises.rm(tmpdir, { recursive: true, force: true })
      reply.code(200).send()
    } catch (error) {
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
  const req = http.request(opts)
  const readStream = fs.createReadStream(filePath)
  form.append('upload', readStream)

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 200)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error, 'request')
  }
})

test('should throw on file limit error, after highWaterMark', async function (t) {
  t.plan(5)

  const hashInput = crypto.createHash('sha256')
  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      await req.saveRequestFiles({ limits: { fileSize: 17000 } })
      reply.code(200).send()
    } catch (error) {
      t.ok(error instanceof fastify.multipartErrors.RequestFileTooLargeError)
      t.equal(error.part.fieldname, 'upload2')
      reply.code(500).send()
    }
  })

  await fastify.listen({ port: 0 })

  // request
  const knownLength = 1024 * 1024 // 1MB
  let total = knownLength
  const form = new FormData({ maxDataSize: total })
  const rs = new Readable({
    read (n) {
      if (n > total) {
        n = total
      }

      const buf = Buffer.alloc(n).fill('x')
      hashInput.update(buf)
      this.push(buf)

      total -= n

      if (total === 0) {
        t.pass('finished generating')
        hashInput.end()
        this.push(null)
      }
    }
  })

  const opts = {
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const req = http.request(opts)
  form.append('upload2', rs, {
    filename: 'random-data',
    contentType: 'binary/octet-stream',
    knownLength
  })

  form.pipe(req)

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 500)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error, 'request')
  }
})

test('should store file on disk, remove on response error, serial', async function (t) {
  t.plan(18)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.equal(req.tmpUploads, null)

    await req.saveRequestFiles()

    t.equal(req.tmpUploads.length, 1)

    throw new Error('test')
  })
  const ee = new EventEmitter()

  // ensure that file is removed after response
  fastify.addHook('onResponse', async (request, reply) => {
    try {
      await access(request.tmpUploads[0], fs.constants.F_OK)
    } catch (error) {
      t.equal(error.code, 'ENOENT')
      t.pass('Temp file was removed after response')
      ee.emit('response')
    }
  })

  await fastify.listen({ port: 0 })

  async function send () {
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
    form.append('upload', fs.createReadStream(filePath))

    try {
      await form.pipe(req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
    await once(ee, 'response')
  }

  await send()
  await send()
  await send()
})

test('should process large files correctly', async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())
    await req.saveRequestFiles()
    return { ok: true }
  })

  await fastify.listen({ port: 0 })

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
  const knownLength = 73550
  const rs = getMockFileStream(knownLength)

  form.append('upload', rs, {
    filename: 'random-data',
    contentType: 'binary/octet-stream',
    knownLength
  })

  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
})

function getMockFileStream (length) {
  let total = length

  const rs = new Readable({
    read (n) {
      if (n > total) {
        n = total
      }

      const buf = Buffer.alloc(n).fill('x')
      this.push(buf)

      total -= n

      if (total === 0) {
        this.push(null)
      }
    }
  })

  return rs
}
