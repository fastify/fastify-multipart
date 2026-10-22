'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const { once } = require('node:events')

/**
 * Regression coverage for filesLimit when the request body is fully buffered
 * before / while parts are consumed (fastify.inject, or http.request + req.end(buf)).
 *
 * On 10.1.0 this throws FilesLimitError (FST_FILES_LIMIT).
 * On 10.1.1 the GHSA-vmph-573x-85f6 fix stopped clearing `currentFile` in
 * `onError`, so filesLimit cleanup destroys the in-flight part stream and
 * consumers often observe ERR_STREAM_PREMATURE_CLOSE instead.
 *
 * Existing filesLimit tests still pass because they use form.pipe(req), which
 * streams the body slowly enough that the previous part is usually fully
 * consumed before filesLimit fires.
 */

async function assertFilesLimitFromBufferedBody (t, send) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(multipart)

  let caught
  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.files({ limits: { files: 5 } })) {
        await part.toBuffer()
      }
      reply.code(200).send({ ok: true })
    } catch (error) {
      caught = error
      reply.code(error.statusCode || 500).send({
        message: error.message,
        code: error.code
      })
    }
  })

  const form = new FormData()
  for (let i = 0; i < 6; i++) {
    form.append('file', Buffer.from(`file-${i}`), {
      filename: `file-${i}.txt`,
      contentType: 'text/plain'
    })
  }

  await send(fastify, form)

  t.assert.ok(caught, 'handler should reject when files limit is exceeded')
  t.assert.ok(
    caught instanceof fastify.multipartErrors.FilesLimitError,
    `expected FilesLimitError, got ${caught && caught.code}: ${caught && caught.message}`
  )
  t.assert.strictEqual(caught.code, 'FST_FILES_LIMIT')
}

test('filesLimit throws FilesLimitError when body is provided via inject (buffered)', async function (t) {
  await assertFilesLimitFromBufferedBody(t, async (fastify, form) => {
    await fastify.ready()
    await fastify.inject({
      method: 'POST',
      url: '/',
      headers: form.getHeaders(),
      payload: form.getBuffer()
    })
  })
})

test('filesLimit throws FilesLimitError when body is ended as a single buffer over http', async function (t) {
  await assertFilesLimitFromBufferedBody(t, async (fastify, form) => {
    await fastify.listen({ port: 0 })

    const payload = form.getBuffer()
    const req = http.request({
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    })
    req.end(payload)

    const [res] = await once(req, 'response')
    res.resume()
    await once(res, 'end')
  })
})
