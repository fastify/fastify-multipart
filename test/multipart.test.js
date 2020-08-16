'use strict'

const util = require('util')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const concat = require('concat-stream')
const { Readable } = require('readable-stream')
const stream = require('stream')
const pump = util.promisify(stream.pipeline)
const sendToWormhole = require('stream-wormhole')

const filePath = path.join(__dirname, '../README.md')

test('should parse forms', function (t) {
  t.plan(8)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { fields: 3 } })

  fastify.post('/', async function (req, reply) {
    for await (const part of req.multipart()) {
      if (part.file) {
        t.equal(part.fieldname, 'upload')
        t.equal(part.filename, 'README.md')
        t.equal(part.encoding, '7bit')
        t.equal(part.mimetype, 'text/markdown')
        t.ok(part.fields.upload)

        const original = fs.readFileSync(filePath, 'utf8')
        await pump(
          part.file,
          concat(function (buf) {
            t.equal(buf.toString(), original)
          })
        )
      }
    }

    reply.code(200).send()
  })

  fastify.listen(0, async function () {
    // request
    const form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      // consume all data without processing
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    const rs = fs.createReadStream(filePath)
    form.append('upload', rs)
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should respond when all files are processed', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const parts = await req.files()
    for await (const part of parts) {
      t.ok(part.file)
      await sendToWormhole(part.file)
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

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should error if it is not multipart', function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.notOk(req.isMultipart())

    try {
      // eslint-disable-next-line
      for await (const _ of req.multipart()) {}
      reply.code(200).send()
    } catch (error) {
      t.equal(error.message, 'the request is not multipart')
      reply.code(500).send()
    }
  })

  fastify.listen(0, function () {
    // request
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      headers: {
        'content-type': 'application/json'
      },
      path: '/',
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
    })
    req.end(JSON.stringify({ hello: 'world' }))
  })
})

test('should error if boundary is empty', function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      // eslint-disable-next-line
      for await (const _ of req.multipart()) {
        t.fail('should not be called')
      }
      reply.code(200).send()
    } catch (error) {
      t.equal(error.message, 'Multipart: Boundary not found')
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
      headers: {
        'content-type': 'multipart/form-data'
      },
      path: '/',
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
    })

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should throw fileSize limitation error on small payload', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      // eslint-disable-next-line
      for await (const _ of req.files({ limits: { fileSize: 2 } })) {
        t.fail('should not be called')
      }
      reply.code(200).send()
    } catch (error) {
      t.equal(error.message, 'Request file too large, please check multipart config')
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
    form.append('upload', fs.createReadStream(filePath))

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should emit fileSize limitation error during streaming', function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))
  const hashInput = crypto.createHash('sha256')

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      for await (const part of req.files({ limits: { fileSize: 16500 } })) {
        await sendToWormhole(part.file, true)
      }
      reply.code(200).send()
    } catch (error) {
      t.equal(error.message, 'Request file too large, please check multipart config')
      reply.code(500).send()
    }
  })

  fastify.listen(0, async function () {
    // request
    const knownLength = 1024 * 1024 // 1MB
    let total = knownLength
    const form = new FormData({ maxDataSize: total })
    const rs = new Readable({
      read (n) {
        if (n > total) {
          n = total
        }

        var buf = Buffer.alloc(n).fill('x')
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
    form.append('upload', rs, {
      filename: 'random-data',
      contentType: 'binary/octect-stream',
      knownLength
    })

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

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})
