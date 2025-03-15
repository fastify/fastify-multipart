'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const h2url = require('h2url')
const path = require('node:path')
const fs = require('node:fs')
const streamToNull = require('../lib/stream-consumer')

const filePath = path.join(__dirname, '../README.md')

test('should respond when all files are processed', function (t, done) {
  t.plan(3)

  const fastify = Fastify({ http2: true })
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const parts = req.files()
    for await (const part of parts) {
      t.assert.ok(part.file)
      await streamToNull(part.file)
    }
    reply.code(200).send()
  })

  fastify.listen({ port: 0 }, async function () {
    const url = `http://localhost:${fastify.server.address().port}`
    const form = new FormData()

    form.append('upload', fs.createReadStream(filePath))
    form.append('upload2', fs.createReadStream(filePath))
    form.append('hello', 'world')
    form.append('willbe', 'dropped')

    const res = await h2url.concat({ url, method: 'POST', headers: form.getHeaders(), body: form })

    t.assert.strictEqual(res.headers[':status'], 200)
    done()
  })
})
