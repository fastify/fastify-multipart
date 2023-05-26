'use strict'

const fastify = require('fastify')({
  // ...
  logger: true,
  ajv: {
    // Adds the file plugin to help @fastify/swagger schema generation
    plugins: [import('..').ajvFilePlugin]
  }
})

fastify.register(require('..'), {
  attachFieldsToBody: true
})

fastify.register(require('fastify-swagger'))
fastify.register(require('@fastify/swagger-ui'))

fastify.post(
  '/upload/files',
  {
    schema: {
      consumes: ['multipart/form-data'],
      body: {
        type: 'object',
        required: ['myField'],
        properties: {
          myField: { isFile: true }
        }
      }
    }
  },
  function (req, reply) {
    console.log({ body: req.body })
    reply.send('done')
  }
)

fastify.listen({ port: 3000 }, (err) => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
