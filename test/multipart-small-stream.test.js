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
const EventEmitter = require('events')
const sendToWormhole = require('stream-wormhole')
const { once } = EventEmitter

const filePath = path.join(__dirname, '../README.md')

test('should throw fileSize limitation error on small payload', async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    const part = await req.file({ limits: { fileSize: 2 } })
    await sendToWormhole(part.file)
    if (part.file.truncated) {
      reply.code(500).send()
    } else {
      reply.code(200).send()
    }
  })

  await fastify.listen(0)

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

  pump(form, req)

  try {
    const [res] = await once(req, 'response')
    t.equal(res.statusCode, 500)
    res.resume()
    await once(res, 'end')
  } catch (error) {
    t.error(error, 'request')
  }
})
