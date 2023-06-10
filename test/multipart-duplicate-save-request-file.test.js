'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const EventEmitter = require('events')
const { once } = EventEmitter

const filePath = path.join(__dirname, '../README.md')

test('should store file on disk, remove on response', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  await fastify.register(multipart)

  await fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const files = await req.saveRequestFiles()
    const files2 = await req.saveRequestFiles()

    // If it really reused the previously response, their filepath should be the same
    t.equal(files[0].filepath, files2[0].filepath)

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
  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
})
