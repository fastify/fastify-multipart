'use strict'

const util = require('util')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const { access } = require('fs').promises
const stream = require('stream')
const pump = util.promisify(stream.pipeline)

const filePath = path.join(__dirname, '../README.md')

test('should store file on disk, remove on response', function (t) {
  t.plan(11)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

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

  // ensure that file is removed after response
  fastify.addHook('onResponse', async (request, reply) => {
    try {
      await access(request.tmpUploads[0], fs.constants.F_OK)
    } catch (error) {
      t.equal(error.code, 'ENOENT')
      t.pass('Temp file was removed after response')
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

test('should store file on disk, remove on response error', function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    await req.saveRequestFiles()

    throw new Error('test')
  })

  // ensure that file is removed after response
  fastify.addHook('onResponse', async (request, reply) => {
    try {
      await access(request.tmpUploads[0], fs.constants.F_OK)
    } catch (error) {
      t.equal(error.code, 'ENOENT')
      t.pass('Temp file was removed after response')
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
