'use strict'

// Regression tests: a non-multipart (application/json) request body must never
// be type-confused into an uploaded file by saveRequestFiles(), and genuine
// multipart uploads must keep working.

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')

const forgedBody = {
  chapter_number: { value: '1' },
  upload: {
    type: 'file',
    fieldname: 'upload',
    filename: '../../../../package.json',
    mimetype: 'text/plain',
    encoding: '7bit',
    file: true,
    _buf: 'attacker-controlled bytes',
    fields: { role: 'admin' }
  }
}

test('JSON body is not type-confused into a file (attachFieldsToBody: true)', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())
  fastify.register(multipart, { attachFieldsToBody: true })

  fastify.post('/', async function (req, reply) {
    t.assert.strictEqual(req.isMultipart(), false)
    const { files } = await req.saveRequestFiles()
    t.assert.strictEqual(files.length, 0)
    return reply.send({ count: files.length })
  })

  const res = await fastify.inject({
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(forgedBody)
  })
  t.assert.strictEqual(res.statusCode, 200)
})

test('JSON body is not type-confused into a file (attachFieldsToBody: keyValues)', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())
  fastify.register(multipart, { attachFieldsToBody: 'keyValues' })

  fastify.post('/', async function (req, reply) {
    t.assert.strictEqual(req.isMultipart(), false)
    const { files } = await req.saveRequestFiles()
    t.assert.strictEqual(files.length, 0)
    return reply.send({ count: files.length })
  })

  const res = await fastify.inject({
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(forgedBody)
  })
  t.assert.strictEqual(res.statusCode, 200)
})

test('genuine multipart upload still works and is basenamed', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())
  fastify.register(multipart, { attachFieldsToBody: true })

  fastify.post('/', async function (req, reply) {
    t.assert.strictEqual(req.isMultipart(), true)
    const { files } = await req.saveRequestFiles()
    t.assert.strictEqual(files.length, 1)
    t.assert.strictEqual(files[0].filename, 'real-upload.txt')
    return reply.send({ filename: files[0].filename })
  })

  await fastify.listen({ port: 0, host: '127.0.0.1' })
  const form = new FormData()
  form.append('upload', Buffer.from('genuine bytes\n'), {
    filename: '../../../../real-upload.txt',
    contentType: 'text/plain'
  })

  const res = await fastify.inject({
    method: 'POST',
    url: '/',
    headers: form.getHeaders(),
    payload: form.getBuffer()
  })
  t.assert.strictEqual(res.statusCode, 200)
})

test('a JSON-typed multipart field is not type-confused into a file (keyValues)', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())
  fastify.register(multipart, { attachFieldsToBody: 'keyValues' })

  fastify.post('/', async function (req, reply) {
    t.assert.strictEqual(req.isMultipart(), true)
    const { files } = await req.saveRequestFiles()
    t.assert.strictEqual(files.length, 0)
    // The real security property: no temporary file was written.
    t.assert.strictEqual(req.tmpUploads.length, 0)
    return reply.send({ count: files.length })
  })

  const form = new FormData()
  // A genuine multipart request whose field is application/json, parsed into an
  // object carrying file/_buf in keyValues mode (isMultipart() is true here, so
  // the brand check, not the isMultipart() guard, is what blocks this).
  form.append('meta', JSON.stringify(forgedBody.upload), { contentType: 'application/json' })

  const res = await fastify.inject({
    method: 'POST',
    url: '/',
    headers: form.getHeaders(),
    payload: form.getBuffer()
  })
  t.assert.strictEqual(res.statusCode, 200)
})

test('a shallow-cloned genuine file wrapper is still saved (attachFieldsToBody: true)', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())
  fastify.register(multipart, { attachFieldsToBody: true })

  fastify.post('/', async function (req, reply) {
    // Applications may normalize or shallow-clone the file wrapper before saving.
    req.body.upload = { ...req.body.upload }
    const { files } = await req.saveRequestFiles()
    t.assert.strictEqual(files.length, 1)
    t.assert.strictEqual(files[0].filename, 'real-upload.txt')
    return reply.send({ count: files.length })
  })

  const form = new FormData()
  form.append('upload', Buffer.from('genuine bytes\n'), {
    filename: '../../../../real-upload.txt',
    contentType: 'text/plain'
  })

  const res = await fastify.inject({
    method: 'POST',
    url: '/',
    headers: form.getHeaders(),
    payload: form.getBuffer()
  })
  t.assert.strictEqual(res.statusCode, 200)
})
