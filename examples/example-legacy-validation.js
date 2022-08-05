'use strict'

const fastify = require('fastify')({ logger: true })

const opts = {
  addToBody: true,
  sharedSchemaId: '#mySharedSchema'
}
fastify.register(require('..'), opts)

fastify.post('/upload/files', {
  schema: {
    body: {
      type: 'object',
      required: ['myStringField'],
      properties: {
        myStringField: { type: 'string' },
        myFilenameField: { $ref: '#mySharedSchema' }
      }
    }
  }
}, function (req, reply) {
  console.log({ body: req.body })
  reply.send('done')
})

fastify.listen({ port: 3000 }, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
