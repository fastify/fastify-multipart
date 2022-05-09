'use strict'

const util = require('util')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const sleep = util.promisify(setTimeout)
const { writableNoopStream } = require('noop-stream')
const stream = require('stream')
const pipeline = util.promisify(stream.pipeline)

test('should finish with error on partial upload', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req) {
    t.ok(req.isMultipart())
    const parts = await req.files()
    try {
      for await (const part of parts) {
        await pipeline(part.file, writableNoopStream())
      }
    } catch (e) {
      t.equal(e.message, 'Premature close', 'File was closed prematurely')
      throw e
    } finally {
      t.pass('Finished request')
    }
    return 'ok'
  })

  await fastify.listen({ port: 0 })
  const dataSize = 1024 * 6
  // request
  const form = new FormData()
  form.append('upload', Buffer.alloc(dataSize))
  const opts = {
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const req = http.request(opts)
  req.on('error', () => {
    t.pass('ended http request with error')
  })
  const data = form.getBuffer()
  req.write(data.slice(0, dataSize / 2))
  await sleep(100)
  req.destroy()
  await sleep(100)
  t.end()
})
