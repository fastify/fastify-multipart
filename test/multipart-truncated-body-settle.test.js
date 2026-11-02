'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { Writable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const Fastify = require('fastify')
const multipart = require('..')

// GHSA-5849-5M6Q-9632: a complete HTTP request whose multipart body ends
// inside a file part (no closing boundary) must not leave a handler that
// delays consuming part.file hanging forever. When a parser error destroys
// the file stream, a later pipeline()/toBuffer() must still settle.
test('truncated multipart body should not hang a delayed part.file consumer', { timeout: 10000 }, async function (t) {
  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(multipart)

  fastify.setErrorHandler((error, request, reply) => {
    reply.send(error)
  })

  fastify.post('/', async function (req) {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        // Simulate asynchronous work (e.g. a DB check) after the file part
        // has been received and the request body fully transmitted, but
        // before the stream is consumed. See GHSA-5849-5M6Q-9632.
        await new Promise(resolve => setTimeout(resolve, 50))
        await pipeline(part.file, new Writable({ write: (_chunk, _enc, cb) => cb() }))
      }
    }
    return { ok: true }
  })

  const boundary = 'reproboundary'
  // The body is complete as far as Content-Length is concerned, but the
  // multipart closing boundary (--<boundary>--) is deliberately missing, so
  // parsing ends inside the file part.
  const malformedBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="a.bin"\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n' +
        'partial-file-bytes'
    )
  ])

  let timer
  const response = await Promise.race([
    fastify.inject({
      method: 'POST',
      url: '/',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: malformedBody
    }),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('request did not settle (handler hung)')), 5000)
    })
  ])
  clearTimeout(timer)

  // The request must settle instead of leaving the handler/connection pending.
  assert.strictEqual(response.statusCode, 500)
})
