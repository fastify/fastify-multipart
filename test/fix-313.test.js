'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const { access } = require('node:fs').promises
const EventEmitter = require('node:events')
const { once } = EventEmitter

const filePath = path.join(__dirname, '../README.md')

test('should store file on disk, remove on response when attach fields to body is true', async function (t) {
  t.plan(25)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    attachFieldsToBody: true
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    const files = await req.saveRequestFiles()

    t.assert.ok(files[0].filepath)
    t.assert.strictEqual(files[0].type, 'file')
    t.assert.strictEqual(files[0].fieldname, 'upload')
    t.assert.strictEqual(files[0].filename, 'README.md')
    t.assert.strictEqual(files[0].encoding, '7bit')
    t.assert.strictEqual(files[0].mimetype, 'text/markdown')
    t.assert.ok(files[0].fields.upload)
    t.assert.ok(files[1].filepath)
    t.assert.strictEqual(files[1].type, 'file')
    t.assert.strictEqual(files[1].fieldname, 'upload')
    t.assert.strictEqual(files[1].filename, 'README.md')
    t.assert.strictEqual(files[1].encoding, '7bit')
    t.assert.strictEqual(files[1].mimetype, 'text/markdown')
    t.assert.ok(files[1].fields.upload)
    t.assert.ok(files[2].filepath)
    t.assert.strictEqual(files[2].type, 'file')
    t.assert.strictEqual(files[2].fieldname, 'other')
    t.assert.strictEqual(files[2].filename, 'README.md')
    t.assert.strictEqual(files[2].encoding, '7bit')
    t.assert.strictEqual(files[2].mimetype, 'text/markdown')
    t.assert.ok(files[2].fields.upload)

    await access(files[0].filepath, fs.constants.F_OK)
    await access(files[1].filepath, fs.constants.F_OK)
    await access(files[2].filepath, fs.constants.F_OK)

    reply.code(200).send()
  })
  const ee = new EventEmitter()

  // ensure that file is removed after response
  fastify.addHook('onResponse', async (request) => {
    try {
      await access(request.tmpUploads[0], fs.constants.F_OK)
    } catch (error) {
      t.assert.strictEqual(error.code, 'ENOENT')
      t.assert.ok('Temp file was removed after response')
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
  t.assert.strictEqual(res.statusCode, 200)
  res.resume()
  await once(res, 'end')
  await once(ee, 'response')
})

test('should throw on saving request files when attach fields to body is true but buffer is not stored', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    attachFieldsToBody: true,
    onFile: async (part) => {
      for await (const chunk of part.file) {
        chunk.toString()
      }
    }
  })

  fastify.post('/', async function (req, reply) {
    t.assert.ok(req.isMultipart())

    try {
      await req.saveRequestFiles()
      reply.code(200).send()
    } catch (error) {
      t.assert.ok(error instanceof fastify.multipartErrors.FileBufferNotFoundError)
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

  const [res] = await once(req, 'response')
  t.assert.strictEqual(res.statusCode, 500)
  res.resume()
  await once(res, 'end')
})
