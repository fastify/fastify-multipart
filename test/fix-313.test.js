'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
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

  fastify.register(multipart, {
    attachFieldsToBody: true
  })

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
  form.append('upload', fs.createReadStream(filePath))
  form.append('other', fs.createReadStream(filePath))

  form.pipe(req)

  const [res] = await once(req, 'response')
  t.equal(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  await once(ee, 'response')
})
