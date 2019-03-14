'use strict'

const fastify = require('fastify')({ logger: true })

fastify.register(require('.'), { addToBody: true })

fastify.post('/upload', {
  schema: {
    body: {
      type: 'object',
      required: ['myStringField', 'myFilenameField'],
      properties: {
        myStringField: { type: 'string' },
        myFilenameField: {
          type: 'object',
          properties: {
            encoding: { type: 'string' },
            filename: { type: 'string' },
            limit: { type: 'boolean' },
            mimetype: { type: 'string' }
          }
        }
      }
    }
  }
}, function (req, reply) {
  console.log({ body: req.body })
  reply.send('done')
})

fastify.listen(3000, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
