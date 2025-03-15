'use strict'

const Fastify = require('fastify')
const FormData = require('form-data')
const http = require('node:http')
const multipart = require('..')
const { once } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const filePath = path.join(__dirname, '../README.md')

test('show modify the generated schema', async t => {
  t.plan(4)

  const fastify = Fastify({
    ajv: {
      plugins: [multipart.ajvFilePlugin]
    }
  })

  t.after(() => fastify.close())

  await fastify.register(multipart, { attachFieldsToBody: true })
  await fastify.register(require('@fastify/swagger'), {
    mode: 'dynamic',

    openapi: {
      openapi: '3.1.0'
    }
  })

  fastify.post(
    '/',
    {
      schema: {
        operationId: 'test',
        consumes: ['multipart/form-data'],
        body: {
          type: 'object',
          properties: {
            field: { isFile: true }
          }
        }
      }
    },
    async function (_req, reply) {
      reply.code(200).send()
    }
  )

  await fastify.ready()

  t.assert.deepEqual(fastify.swagger().paths, {
    '/': {
      post: {
        operationId: 'test',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  field: { type: 'string', format: 'binary' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Default Response' }
        }
      }
    }
  })

  await fastify.listen({ port: 0 })

  // request without file
  {
    const form = new FormData()
    const req = http.request({
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    })

    form.append('field', JSON.stringify({}), { contentType: 'application/json' })
    form.pipe(req)

    const [res] = await once(req, 'response')
    res.resume()
    await once(res, 'end')
    t.assert.strictEqual(res.statusCode, 400) // body/field should be a file
  }

  // request with file
  {
    const form = new FormData()
    const req = http.request({
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    })

    form.append('field', fs.createReadStream(filePath), { contentType: 'multipart/form-data' })
    form.pipe(req)

    const [res] = await once(req, 'response')
    res.resume()
    await once(res, 'end')
    t.assert.strictEqual(res.statusCode, 200)
  }
  t.assert.ok('res ended successfully')
})
