'use strict'

const test = require('tap').test
const Fastify = require('fastify')
const multipart = require('..')

test('show modify the generated schema', async function (t) {
  t.plan(1)

  const fastify = Fastify({
    ajv: {
      plugins: [multipart.ajvFilePlugin]
    }
  })

  t.teardown(fastify.close.bind(fastify))

  await fastify.register(multipart)
  await fastify.register(require('@fastify/swagger'), {
    mode: 'dynamic',

    openapi: {
      openapi: '3.1.0'
    }
  })

  await fastify.post(
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
    async function (req, reply) {
      reply.send('hello')
    }
  )

  await fastify.ready()

  t.match(fastify.swagger(), {
    paths: {
      '/': {
        post: {
          operationId: 'test',
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: { field: { type: 'file' } }
                }
              }
            }
          },
          responses: {
            200: { description: 'Default Response' }
          }
        }
      }
    }
  })
})
