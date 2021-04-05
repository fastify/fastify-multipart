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
const pump = util.promisify(stream.pipeline)

const filePath = path.join(__dirname, '../README.md')

test('should be able to get whole buffer by accessing "content" on part', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  const original = fs.readFileSync(filePath, 'utf8')

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const file = await req.file()
    // lazy load (getter)
    const buf = await file.toBuffer()

    t.equal(buf.toString(), original)

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

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})

test('should be able to access "content" multiple times without reading the stream twice', function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  const original = fs.readFileSync(filePath, 'utf8')

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const file = await req.file()
    // lazy load (getter)
    const buf = await file.toBuffer()
    const buf2 = await file.toBuffer()

    t.equal(buf.toString(), original)
    t.equal(buf2.toString(), original)

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

    try {
      await pump(form, req)
    } catch (error) {
      t.error(error, 'formData request pump: no err')
    }
  })
})
