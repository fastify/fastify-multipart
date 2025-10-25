'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const multipart = require('..')

test('malformed request should not cause uncaught exception when await before req.file()', async function (t) {
  const fastify = Fastify()

  await fastify.register(multipart)

  let errorListenerCalled = false
  let errorCaught = false

  fastify.post('/', async function (req, reply) {
    // Simulate any async operation before req.file()
    // This allows request parsing to start before we get the file
    await new Promise(resolve => setImmediate(resolve))

    try {
      const data = await req.file()

      if (data) {
        // Attach error listener
        data.file.on('error', (_err) => {
          errorListenerCalled = true
        })

        // Try to consume the file
        await data.toBuffer()
      }

      reply.code(200).send({ ok: true })
    } catch (err) {
      errorCaught = true
      reply.code(400).send({ error: err.message })
    }
  })

  await fastify.listen({ port: 0 })

  // Send malformed multipart request (missing closing boundary)
  // Manually construct malformed multipart data
  const malformedData = '------MyBoundary\r\n' +
    'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n' +
    'Content-Type: text/plain\r\n' +
    '\r\n' +
    'ABC'
  // Note: Missing closing boundary (------MyBoundary--)

  try {
    const response = await fastify.inject({
      method: 'POST',
      url: '/',
      headers: {
        'content-type': 'multipart/form-data; boundary=----MyBoundary'
      },
      payload: malformedData
    })

    // The request should complete without crashing
    assert.ok(response, 'request completed without uncaught exception')
  } catch (err) {
    // Even if there's an error, it should be catchable
    assert.ok(err, 'error was catchable')
  }

  assert.ok(errorListenerCalled || errorCaught, 'error was handled either by listener or catch block')

  await fastify.close()
})

test('malformed request with req.files() should not cause uncaught exception', async function (t) {
  const fastify = Fastify()

  await fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    await new Promise(resolve => setImmediate(resolve))

    try {
      const files = req.files()

      for await (const file of files) {
        file.file.on('error', () => {})
        await file.toBuffer().catch(() => {})
      }

      reply.code(200).send({ ok: true })
    } catch (err) {
      reply.code(400).send({ error: err.message })
    }
  })

  await fastify.listen({ port: 0 })

  const malformedData = '------MyBoundary\r\n' +
    'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n' +
    'Content-Type: text/plain\r\n' +
    '\r\n' +
    'ABC'

  try {
    const response = await fastify.inject({
      method: 'POST',
      url: '/',
      headers: {
        'content-type': 'multipart/form-data; boundary=----MyBoundary'
      },
      payload: malformedData
    })

    assert.ok(response, 'request completed without uncaught exception')
  } catch (err) {
    assert.ok(err, 'error was catchable')
  }

  await fastify.close()
})

test('malformed request with req.parts() should not cause uncaught exception', async function (t) {
  const fastify = Fastify()

  await fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    await new Promise(resolve => setImmediate(resolve))

    try {
      const parts = req.parts()

      for await (const part of parts) {
        if (part.file) {
          part.file.on('error', () => {})
          await part.toBuffer().catch(() => {})
        }
      }

      reply.code(200).send({ ok: true })
    } catch (err) {
      reply.code(400).send({ error: err.message })
    }
  })

  await fastify.listen({ port: 0 })

  const malformedData = '------MyBoundary\r\n' +
    'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n' +
    'Content-Type: text/plain\r\n' +
    '\r\n' +
    'ABC'

  try {
    const response = await fastify.inject({
      method: 'POST',
      url: '/',
      headers: {
        'content-type': 'multipart/form-data; boundary=----MyBoundary'
      },
      payload: malformedData
    })

    assert.ok(response, 'request completed without uncaught exception')
  } catch (err) {
    assert.ok(err, 'error was catchable')
  }

  await fastify.close()
})
