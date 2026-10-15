'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const { once } = require('node:events')
const { setTimeout: sleep } = require('node:timers/promises')

// A client that sends a complete upload (so saveRequestFiles resolves) and then
// disconnects while the handler is still working, before it writes the reply.
// reply.raw emits 'close' but never 'finish', so the onResponse cleanup never
// runs; the saved temp files must still be removed.
// @see https://github.com/fastify/fastify-multipart/security/advisories/GHSA-r9rg-mfh6-f225
test('should not leak temp files when the client disconnects after saveRequestFiles resolves', async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.after(() => fastify.close())
  await fastify.register(multipart)

  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'multipart-'))
  t.after(() => fs.rm(tmpdir, { recursive: true, force: true }))

  let signalSaved
  const saved = new Promise((resolve) => { signalSaved = resolve })
  let tmpUploads = []

  fastify.post('/', async function (req, reply) {
    await req.saveRequestFiles({ tmpdir })
    tmpUploads = req.tmpUploads
    signalSaved()
    // simulate post-save work (scan, hash, S3 upload) during which the client leaves
    await sleep(1000)
    reply.send()
  })

  await fastify.listen({ port: 0 })

  const form = new FormData()
  form.append('f', Buffer.alloc(1024), { filename: 'evil.bin' })
  const req = http.request({
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  })
  req.on('error', () => {})
  req.end(form.getBuffer()) // send the complete multipart body

  await saved // saveRequestFiles has resolved on the server
  t.assert.strictEqual(tmpUploads.length, 1, 'a temp file was saved')

  req.destroy() // disconnect after the save, during the handler's post-save work

  await sleep(500) // let the close cleanup run
  let leaked = false
  for (const filepath of tmpUploads) {
    try {
      await fs.access(filepath)
      leaked = true
    } catch {
      // cleaned up
    }
  }
  t.assert.ok(!leaked, 'temp file was removed after the client disconnected')
})

// With attachFieldsToBody the body is buffered before the handler runs, so a
// client that disconnects before the handler calls saveRequestFiles() still
// gets files written to disk afterwards. The close fired while tmpUploads was
// null, so the files must be cleaned once saveRequestFiles() has saved them.
// @see https://github.com/fastify/fastify-multipart/security/advisories/GHSA-r9rg-mfh6-f225
test('should not leak temp files when the client disconnects before saveRequestFiles (buffered body)', async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.after(() => fastify.close())
  await fastify.register(multipart, { attachFieldsToBody: true })

  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'multipart-'))
  t.after(() => fs.rm(tmpdir, { recursive: true, force: true }))

  let signalSaved
  const saved = new Promise((resolve) => { signalSaved = resolve })
  let tmpUploads = []

  fastify.post('/', async function (req, reply) {
    await sleep(400) // pre-save work; the client disconnects during this window
    await req.saveRequestFiles({ tmpdir })
    tmpUploads = req.tmpUploads
    signalSaved()
    reply.send()
  })

  await fastify.listen({ port: 0 })

  const form = new FormData()
  form.append('f', Buffer.alloc(1024), { filename: 'evil.bin' })
  const req = http.request({
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  })
  req.on('error', () => {})
  req.end(form.getBuffer())

  await sleep(150)
  req.destroy() // disconnect before the handler reaches saveRequestFiles

  await Promise.race([saved, sleep(2000)])
  t.assert.strictEqual(tmpUploads.length, 1, 'a temp file was saved from the buffered body')

  let leaked = false
  for (const filepath of tmpUploads) {
    try {
      await fs.access(filepath)
      leaked = true
    } catch {
      // cleaned up
    }
  }
  t.assert.ok(!leaked, 'temp file was removed even though it was saved after the disconnect')
})

// With attachFieldsToBody the body is buffered in memory, so saveRequestFiles
// can still write files to disk even if it is called after the response has
// already finished (onResponse ran while tmpUploads was still null). No further
// onResponse or close cleanup runs for those files, so saveRequestFiles must
// clean them once it sees the response already ended.
// @see https://github.com/fastify/fastify-multipart/security/advisories/GHSA-r9rg-mfh6-f225
test('should not leak temp files when saveRequestFiles runs after the response finished (buffered body)', async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.after(() => fastify.close())
  await fastify.register(multipart, { attachFieldsToBody: true })

  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'multipart-'))
  t.after(() => fs.rm(tmpdir, { recursive: true, force: true }))

  let signalSaved
  const saved = new Promise((resolve) => { signalSaved = resolve })
  let tmpUploads = []

  fastify.post('/', async function (req, reply) {
    reply.send('ok')
    await once(reply.raw, 'finish') // onResponse has already run (tmpUploads null)
    await req.saveRequestFiles({ tmpdir })
    tmpUploads = req.tmpUploads
    signalSaved()
  })

  await fastify.listen({ port: 0 })

  const form = new FormData()
  form.append('f', Buffer.alloc(1024), { filename: 'evil.bin' })
  const req = http.request({
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  })
  req.on('error', () => {})
  const responseReceived = once(req, 'response')
  req.end(form.getBuffer())

  const [res] = await responseReceived
  res.resume() // read the full response, keep the connection alive

  await saved
  t.assert.strictEqual(tmpUploads.length, 1, 'a temp file was saved after the response finished')

  let leaked = false
  for (const filepath of tmpUploads) {
    try {
      await fs.access(filepath)
      leaked = true
    } catch {
      // cleaned up
    }
  }
  t.assert.ok(!leaked, 'temp file was removed even though it was saved after the response finished')
})
