'use strict'

const fastify = require('fastify')({ logger: true })
const Ajv = require('ajv')

const ajv = new Ajv({
  /**
   * default values of Fastify
   * Docs: https://www.fastify.io/docs/latest/Reference/Validation-and-Serialization/#validator-compiler
   *   */

  coerceTypes: 'array', // change data type of data to match type keyword
  useDefaults: true, // replace missing properties and items with the values from corresponding default keyword
  removeAdditional: true, // remove additional properties
  uriResolver: require('fast-uri'),
  addUsedSchema: false,
  // Explicitly set allErrors to `false`.
  // When set to `true`, a DoS attack is possible.
  allErrors: false
})
ajv.addKeyword({
  keyword: 'isFile',
  compile: (_schema, parent, _it) => {
    parent.type = 'file'
    delete parent.isFile
    return () => true
  }
})
fastify.setValidatorCompiler(({ schema, method, url, httpPart }) => {
  return ajv.compile(schema)
})
const opts = {
  attachFieldsToBody: true
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
