'use strict'

const test = require('node:test')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const net = require('node:net')
const { once } = require('node:events')
const { setTimeout: sleep } = require('node:timers/promises')

const BOUNDARY = 'fix630boundary'

function filePart (fieldname, filename, payload) {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="${fieldname}"; filename="${filename}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n'
    ),
    payload,
    Buffer.from('\r\n')
  ])
}

function fieldPart (fieldname, value) {
  return Buffer.from(
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="${fieldname}"\r\n\r\n` +
    `${value}\r\n`
  )
}

const closingBoundary = Buffer.from(`--${BOUNDARY}--\r\n`)

// Reproduces https://github.com/fastify/fastify-multipart/issues/630
// The request emits 'close' once its body is fully piped into busboy,
// which can happen while the consumer is still slowly reading an earlier
// file part and busboy is still holding undelivered parts. Those trailing
// parts must still be yielded instead of being cut off by the end marker.
test('parts() delivers trailing parts even when the request closes while busboy still buffers them', async function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.after(() => fastify.close())

  // a large busboy highWaterMark lets the whole request body drain into
  // busboy's writable buffer at once, so the request emits 'close' while
  // busboy still holds undelivered parts. The same ordering happens with
  // the default highWaterMark when a proxy re-segments the stream.
  fastify.register(multipart, { highWaterMark: 2 * 1024 * 1024 })

  fastify.post('/', async function (req) {
    const seen = []
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        let size = 0
        for await (const chunk of part.file) {
          size += chunk.length
          // simulate a slow storage write so the request finishes piping
          // (and emits 'close') while we are still consuming this file
          await sleep(10)
        }
        seen.push({ type: 'file', fieldname: part.fieldname, size })
      } else {
        seen.push({ type: 'field', fieldname: part.fieldname })
      }
    }
    return { seen }
  })

  await fastify.listen({ port: 0 })

  const image = Buffer.alloc(200 * 1024, 'a')
  const mask = Buffer.alloc(6 * 1024, 'b')
  const body = Buffer.concat([
    filePart('file', 'image.bin', image),
    filePart('mask', 'mask.bin', mask),
    fieldPart('clientJobId', 'job-1'),
    fieldPart('format', 'png'),
    fieldPart('quality', '90'),
    closingBoundary
  ])

  const req = http.request({
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': body.length
    }
  })
  req.end(body)

  const [res] = await once(req, 'response')
  t.assert.strictEqual(res.statusCode, 200)

  const chunks = []
  for await (const chunk of res) {
    chunks.push(chunk)
  }
  const { seen } = JSON.parse(Buffer.concat(chunks))
  t.assert.deepStrictEqual(seen, [
    { type: 'file', fieldname: 'file', size: image.length },
    { type: 'file', fieldname: 'mask', size: mask.length },
    { type: 'field', fieldname: 'clientJobId' },
    { type: 'field', fieldname: 'format' },
    { type: 'field', fieldname: 'quality' }
  ])
})

test('parts() rejects when the multipart data is truncated instead of ending cleanly', async function (t) {
  t.plan(3)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts()) {
        if (part.file) {
          await part.toBuffer()
        }
      }
    } catch (err) {
      t.assert.strictEqual(err.message, 'Unexpected end of multipart data')
      return reply.code(400).send({ error: 'truncated' })
    }
    return reply.send({ error: 'iteration ended cleanly' })
  })

  await fastify.listen({ port: 0 })

  // a complete first part but no closing boundary: the request body ends
  // normally at the HTTP layer while the multipart data is truncated
  const body = Buffer.concat([
    filePart('file', 'image.bin', Buffer.alloc(1024, 'a')),
    fieldPart('clientJobId', 'job-1')
  ])

  const req = http.request({
    protocol: 'http:',
    hostname: 'localhost',
    port: fastify.server.address().port,
    path: '/',
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': body.length
    }
  })
  req.end(body)

  const [res] = await once(req, 'response')
  t.assert.strictEqual(res.statusCode, 400)
  res.resume()
  await once(res, 'end')
  t.assert.ok('request completed')
})

test('parts() rejects when the client aborts mid-upload instead of ending cleanly', async function (t) {
  t.plan(1)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  let handled
  const handledPromise = new Promise((resolve) => { handled = resolve })

  fastify.post('/', async function (req, reply) {
    try {
      for await (const part of req.parts()) {
        if (part.file) {
          for await (const chunk of part.file) {
            chunk.toString()
          }
        }
      }
      handled({ outcome: 'clean end' })
    } catch (err) {
      handled({ outcome: 'error', message: err.message })
    }
    return reply.send()
  })

  await fastify.listen({ port: 0 })

  const body = Buffer.concat([
    filePart('file', 'image.bin', Buffer.alloc(64 * 1024, 'a')),
    fieldPart('clientJobId', 'job-1'),
    closingBoundary
  ])

  const socket = net.connect(fastify.server.address().port, 'localhost')
  await once(socket, 'connect')
  socket.write(
    'POST / HTTP/1.1\r\n' +
    'Host: localhost\r\n' +
    `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
    `Content-Length: ${body.length}\r\n` +
    '\r\n'
  )
  // send only part of the body, then abort the connection
  socket.write(body.subarray(0, 16 * 1024))
  await sleep(100)
  socket.destroy()

  const result = await handledPromise
  t.assert.strictEqual(result.outcome, 'error', `iteration must reject on abort, got: ${JSON.stringify(result)}`)
})
