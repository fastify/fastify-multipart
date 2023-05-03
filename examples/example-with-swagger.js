'use strict'
const ajvFilePlugin = (ajv, options = {}) => {
  return ajv.addKeyword({
    keyword: 'isFile',
    compile: (_schema, parent, _it) => {
      parent.type = 'file'
      delete parent.isFile
      return () => true
    }
  })
}
const fastify = require('fastify')({
  logger: true,
  ajv: {
    plugins: [ajvFilePlugin]
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
