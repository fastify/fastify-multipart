'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')

const filePath = path.join(__dirname, '../README.md')

test('should be able to get whole buffer by accessing "content" on part', function (t, done) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  const original = fs.readFileSync(filePath, 'utf8')

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const file = await req.file()
    // lazy load (getter)
    const buf = await file.toBuffer()

    t.assert.strictEqual(buf.toString(), original)

    reply.code(200).send()
  })

  fastify.listen({ port: 0 }, function () {
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
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.pipe(req)
  })
})

test('should be able to access "content" multiple times without reading the stream twice', function (t, done) {
  t.plan(5)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  const original = fs.readFileSync(filePath, 'utf8')

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const file = await req.file()
    // lazy load (getter)
    const buf = await file.toBuffer()
    const buf2 = await file.toBuffer()

    t.assert.strictEqual(buf.toString(), original)
    t.assert.strictEqual(buf2.toString(), original)

    reply.code(200).send()
  })

  fastify.listen({ port: 0 }, function () {
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
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.pipe(req)
  })
})
