'use strict'

/**
 * Regression coverage for parser limits raised before the consumer has picked
 * up the part busboy is holding.
 *
 * A parser limit does not truncate the part in flight: busboy keeps parsing, it
 * completes on its own, and the consumer has to read it before it can observe
 * the limit error. Destroying it during cleanup strands the consumer, and with
 * a body that reaches busboy in one piece the limit fires before the consumer
 * has resumed at all.
 *
 * `multipart-files-limit-buffered-body.test.js` covers what a `toBuffer()`
 * consumer sees when `filesLimit` is hit that way. This file covers the cases
 * it does not:
 *
 *   - an `onFile` consumer, which does not throw but hangs: it receives a
 *     stream that has already emitted 'close', so `pipeline()` attaches its
 *     end-of-stream listener too late to observe anything and never settles.
 *   - `partsLimit`.
 *   - `fieldsLimit`, which unlike the other two does not stop busboy emitting
 *     parts -- it only suppresses further *fields*, so a file after it becomes
 *     the part in flight by the time the deferred cleanup runs. That part can
 *     still be mid-arrival when cleanup runs, which is covered here with a body
 *     split across two chunks.
 *
 * The existing limit tests use form.pipe(req), which feeds busboy slowly enough
 * that the consumer has usually drained the previous part before the limit
 * fires, so they do not cover any of this.
 */

const test = require('node:test')
const http = require('node:http')
const { once } = require('node:events')
const { setTimeout: sleep } = require('node:timers/promises')
const { pipeline } = require('node:stream/promises')
const { PassThrough } = require('node:stream')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')

const SETTLE_TIMEOUT = 3000

function formWithFiles (count) {
  const form = new FormData()
  for (let i = 0; i < count; ++i) {
    form.append('file', Buffer.from(`file-${i}`), {
      filename: `file-${i}.txt`,
      contentType: 'text/plain'
    })
  }
  return form
}

function formWithFieldsThenFile (fieldCount) {
  const form = new FormData()
  for (let i = 0; i < fieldCount; ++i) {
    form.append(`field-${i}`, `value-${i}`)
  }
  form.append('file', Buffer.from('after-the-fields-limit'), {
    filename: 'after-limit.txt',
    contentType: 'text/plain'
  })
  return form
}

async function injectBufferedBody (fastify, form) {
  await fastify.ready()
  return fastify.inject({
    method: 'POST',
    url: '/',
    headers: form.getHeaders(),
    payload: form.getBuffer()
  })
}

async function endBufferedBodyOverHttp (fastify, form) {
  await fastify.listen({ port: 0 })

  const req = http.request({
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: fastify.server.address().port,
    path: '/',
    headers: form.getHeaders(),
    method: 'POST'
  })
  req.end(form.getBuffer())

  const [res] = await once(req, 'response')
  res.resume()
  await once(res, 'end')
  return res
}

function registerOnFileConsumer (fastify, limits) {
  fastify.register(multipart, {
    attachFieldsToBody: true,
    limits,
    async onFile (part) {
      await pipeline(part.file, new PassThrough().resume())
    }
  })

  fastify.post('/', async function (req, reply) {
    reply.code(200).send({ ok: true })
  })
}

// Racing a timeout keeps a regression here reported as a failure instead of
// wedging the whole test file.
function settleWithin (pending) {
  return Promise.race([
    pending,
    new Promise((resolve) => setTimeout(resolve, SETTLE_TIMEOUT, null).unref())
  ])
}

for (const [label, send] of [['inject', injectBufferedBody], ['http', endBufferedBodyOverHttp]]) {
  test(`filesLimit settles an onFile consumer instead of hanging (${label})`, async function (t) {
    t.plan(3)

    const fastify = Fastify({ forceCloseConnections: true })
    t.after(() => fastify.close())

    registerOnFileConsumer(fastify, { files: 1 })

    const res = await settleWithin(send(fastify, formWithFiles(2)))

    t.assert.ok(res, 'the request settled instead of hanging on the destroyed part')
    t.assert.strictEqual(res && res.statusCode, 413)
    t.assert.strictEqual(res && res.headers['content-type'].includes('application/json'), true)
  })
}

test('partsLimit throws PartsLimitError when the body is buffered', async function (t) {
  t.plan(2)

  const fastify = Fastify({ forceCloseConnections: true })
  t.after(() => fastify.close())

  fastify.register(multipart)

  let caught
  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts({ limits: { parts: 2 } })) {
        if (part.file) {
          await part.toBuffer()
        }
      }
      reply.code(200).send({ ok: true })
    } catch (error) {
      caught = error
      reply.code(error.statusCode || 500).send({ code: error.code })
    }
  })

  await injectBufferedBody(fastify, formWithFiles(4))

  t.assert.ok(caught instanceof fastify.multipartErrors.PartsLimitError, `expected PartsLimitError, got ${caught && caught.code}: ${caught && caught.message}`)
  t.assert.strictEqual(caught.code, 'FST_PARTS_LIMIT')
})

test('fieldsLimit keeps a file emitted after the limit readable', async function (t) {
  t.plan(3)

  const fastify = Fastify({ forceCloseConnections: true })
  t.after(() => fastify.close())

  fastify.register(multipart, { limits: { fields: 1 } })

  let caught
  let readAfterLimit
  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts()) {
        if (part.file) {
          readAfterLimit = (await part.toBuffer()).toString()
        }
      }
      reply.code(200).send({ ok: true })
    } catch (error) {
      caught = error
      reply.code(error.statusCode || 500).send({ code: error.code })
    }
  })

  await injectBufferedBody(fastify, formWithFieldsThenFile(2))

  t.assert.strictEqual(readAfterLimit, 'after-the-fields-limit', 'the file after the limit stayed readable')
  t.assert.ok(caught instanceof fastify.multipartErrors.FieldsLimitError, `expected FieldsLimitError, got ${caught && caught.code}: ${caught && caught.message}`)
  t.assert.strictEqual(caught.code, 'FST_FIELDS_LIMIT')
})

test('fieldsLimit settles an onFile consumer reading a file emitted after the limit', async function (t) {
  t.plan(2)

  const fastify = Fastify({ forceCloseConnections: true })
  t.after(() => fastify.close())

  registerOnFileConsumer(fastify, { fields: 1 })

  const res = await settleWithin(injectBufferedBody(fastify, formWithFieldsThenFile(2)))

  t.assert.ok(res, 'the request settled instead of hanging on the destroyed part')
  t.assert.strictEqual(res && res.statusCode, 413)
})

// A body split so that the limit and the following file header land together,
// with the file's body still arriving. The response listener goes on before the
// first write: a late listener misses a response delivered between the chunks
// and makes a working version look like it hung.
const CHUNKED_BOUNDARY = '----chunked-fields-limit'
const CHUNKED_FILE = Buffer.alloc(64 * 1024, 'x')
const chunkText = (s) => Buffer.from(s, 'utf8')

const chunkedHead = Buffer.concat([
  chunkText(`--${CHUNKED_BOUNDARY}\r\nContent-Disposition: form-data; name="field-0"\r\n\r\na\r\n`),
  chunkText(`--${CHUNKED_BOUNDARY}\r\nContent-Disposition: form-data; name="field-1"\r\n\r\nb\r\n`),
  chunkText(`--${CHUNKED_BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="after-limit.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
  CHUNKED_FILE.subarray(0, 100)
])
const chunkedTail = Buffer.concat([
  CHUNKED_FILE.subarray(100),
  chunkText(`\r\n--${CHUNKED_BOUNDARY}--\r\n`)
])

async function sendInTwoChunks (fastify) {
  await fastify.listen({ port: 0 })

  const req = http.request({
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: fastify.server.address().port,
    path: '/',
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${CHUNKED_BOUNDARY}`,
      'content-length': chunkedHead.length + chunkedTail.length
    }
  })
  req.on('error', () => {})

  const responded = once(req, 'response').then(([res]) => {
    res.resume()
    return once(res, 'end').then(() => res)
  })

  req.write(chunkedHead)
  await sleep(200)
  req.write(chunkedTail)
  req.end()

  return settleWithin(responded)
}

test('fieldsLimit reports the limit on a file still arriving when cleanup runs', async function (t) {
  t.plan(4)

  const fastify = Fastify({ forceCloseConnections: true })
  t.after(() => fastify.close())

  fastify.register(multipart, { limits: { fields: 1 } })

  let caught
  let bytesRead
  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts()) {
        if (part.file) {
          bytesRead = (await part.toBuffer()).length
        }
      }
      reply.code(200).send({ ok: true })
    } catch (error) {
      caught = error
      reply.code(error.statusCode || 500).send({ code: error.code })
    }
  })

  const res = await sendInTwoChunks(fastify)

  t.assert.ok(res, 'the request settled')
  t.assert.strictEqual(bytesRead, CHUNKED_FILE.length, 'the file arriving across chunks was read in full')
  t.assert.ok(caught instanceof fastify.multipartErrors.FieldsLimitError, `expected FieldsLimitError, got ${caught && caught.code}: ${caught && caught.message}`)
  t.assert.strictEqual(res.statusCode, 413)
})

test('fieldsLimit reports the limit to an onFile consumer reading that file', async function (t) {
  t.plan(2)

  const fastify = Fastify({ forceCloseConnections: true })
  t.after(() => fastify.close())

  registerOnFileConsumer(fastify, { fields: 1 })

  const res = await sendInTwoChunks(fastify)

  t.assert.ok(res, 'the request settled')
  t.assert.strictEqual(res.statusCode, 413)
})

// The other cross-chunk ordering: the limit is raised in the first chunk and
// the whole file arrives in a second one, so the consumer has already been
// handed the limit error before busboy emits that file. Nothing reads it --
// leaving the request piped must not leave the response owed.
async function sendFileInSecondChunk (fastify) {
  await fastify.listen({ port: 0 })

  const fields = Buffer.concat([
    chunkText(`--${CHUNKED_BOUNDARY}\r\nContent-Disposition: form-data; name="field-0"\r\n\r\na\r\n`),
    chunkText(`--${CHUNKED_BOUNDARY}\r\nContent-Disposition: form-data; name="field-1"\r\n\r\nb\r\n`)
  ])
  const file = Buffer.concat([
    chunkText(`--${CHUNKED_BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="unread.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    CHUNKED_FILE,
    chunkText(`\r\n--${CHUNKED_BOUNDARY}--\r\n`)
  ])

  const req = http.request({
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: fastify.server.address().port,
    path: '/',
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${CHUNKED_BOUNDARY}`,
      'content-length': fields.length + file.length
    }
  })
  req.on('error', () => {})

  const responded = once(req, 'response').then(([res]) => {
    res.resume()
    return once(res, 'end').then(() => res)
  })

  req.write(fields)
  await sleep(200)
  req.write(file)
  req.end()

  return settleWithin(responded)
}

test('fieldsLimit answers even when the file arrives after the error was delivered', async function (t) {
  t.plan(3)

  const fastify = Fastify({ forceCloseConnections: true })
  t.after(() => fastify.close())

  fastify.register(multipart, { limits: { fields: 1 } })

  let caught
  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts()) {
        if (part.file) {
          await part.toBuffer()
        }
      }
      reply.code(200).send({ ok: true })
    } catch (error) {
      caught = error
      reply.code(error.statusCode || 500).send({ code: error.code })
    }
  })

  const res = await sendFileInSecondChunk(fastify)

  t.assert.ok(res, 'the response was not left owed on the unread part')
  t.assert.ok(caught instanceof fastify.multipartErrors.FieldsLimitError, `expected FieldsLimitError, got ${caught && caught.code}: ${caught && caught.message}`)
  t.assert.strictEqual(res.statusCode, 413)
})

test('fieldsLimit answers an onFile consumer when the file arrives after the error', async function (t) {
  t.plan(2)

  const fastify = Fastify({ forceCloseConnections: true })
  t.after(() => fastify.close())

  registerOnFileConsumer(fastify, { fields: 1 })

  const res = await sendFileInSecondChunk(fastify)

  t.assert.ok(res, 'the response was not left owed on the unread part')
  t.assert.strictEqual(res.statusCode, 413)
})
