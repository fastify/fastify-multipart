'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const h2url = require('h2url')
const path = require('node:path')
const fs = require('node:fs')
const streamToNull = require('../lib/stream-consumer')

const filePath = path.join(__dirname, '../README.md')

test('should respond when all files are processed', async function (t) {
  const fastify = Fastify({ http2: true })
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    const parts = req.files()
    for await (const part of parts) {
      t.ok(part.file)
      await streamToNull(part.file)
    }
    reply.code(200).send()
  })

  await fastify.listen({ port: 0 })

  const url = `http://localhost:${fastify.server.address().port}`
  const form = new FormData()

  form.append('upload', fs.createReadStream(filePath))
  form.append('upload2', fs.createReadStream(filePath))
  form.append('hello', 'world')
  form.append('willbe', 'dropped')

  const res = await h2url.concat({ url, method: 'POST', headers: form.getHeaders(), body: form })

  t.equal(res.headers[':status'], 200)
})
