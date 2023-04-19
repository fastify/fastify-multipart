'use strict'

const fastify = require('fastify')({ logger: true })

const opts = {
  attachFieldsToBody: true,
  sharedSchemaId: '#mySharedSchema'
}
fastify.register(require('..'), opts)

fastify.post(
  '/upload/files',
  {
    schema: {
      consumes: ['multipart/form-data'],
      body: {
        type: 'object',
        required: ['myField'],
        properties: {
          myField: { $ref: '#mySharedSchema' }
        }
      }
    }
  },
  function (req, reply) {
    console.log({ body: req.body })
    reply.send('done')
  }
)

fastify.listen({ port: 3000 }, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
