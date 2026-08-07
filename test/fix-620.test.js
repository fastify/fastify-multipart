'use strict'

const test = require('node:test')
const Fastify = require('fastify')
const http = require('node:http')
const crypto = require('node:crypto')
const { PassThrough } = require('node:stream')
const { once } = require('node:events')
const multipart = require('..')

const BOUNDARY = 'fix620boundary'

function fieldPart (fieldname, value) {
  return Buffer.from(
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="${fieldname}"\r\n\r\n` +
    `${value}\r\n`
  )
}

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

const closingBoundary = Buffer.from(`--${BOUNDARY}--\r\n`)

test('multipart parsing follows the stream returned by a preParsing hook', async function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart)

  let digest

  fastify.addHook('preParsing', async function (request, reply, payload) {
    const clone = new PassThrough()
    const hash = crypto.createHash('sha256')

    payload.on('data', (chunk) => {
      hash.update(chunk)
      clone.write(chunk)
    })
    payload.on('end', () => {
      digest = hash.digest('hex')
      clone.end()
    })
    payload.on('error', (err) => clone.destroy(err))

    return clone
  })

  fastify.post('/', async function (req) {
    const seen = []
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        seen.push({ type: 'file', fieldname: part.fieldname, buf: (await part.toBuffer()).toString() })
      } else {
        seen.push({ type: 'field', fieldname: part.fieldname, value: part.value })
      }
    }
    return { seen, digest }
  })

  await fastify.listen({ port: 0 })

  const body = Buffer.concat([
    fieldPart('clientJobId', 'job-1'),
    filePart('file', 'hello.txt', Buffer.from('hello world')),
    closingBoundary
  ])

  const expectedDigest = crypto.createHash('sha256').update(body).digest('hex')

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
  const { seen, digest: receivedDigest } = JSON.parse(Buffer.concat(chunks))

  t.assert.deepStrictEqual(seen, [
    { type: 'field', fieldname: 'clientJobId', value: 'job-1' },
    { type: 'file', fieldname: 'file', buf: 'hello world' }
  ])
  t.assert.strictEqual(receivedDigest, expectedDigest)
  t.assert.ok(receivedDigest)
})
