'use strict'

const fp = require('fastify-plugin')
const multipartReadStream = require('multipart-read-stream')
const pump = require('pump')

function fastifyMultipart (fastify, options, done) {
  fastify.addContentTypeParser('multipart', function (req, done) {
    // nothing to do, it will be done by the Request.multipart object
    done()
  })

  fastify.decorateRequest('multipart', multipart)

  done()

  // handler definition is in multipart-readstream
  // handler(field, file, filename, encoding, mimetype)
  function multipart (handler, done) {
    if (typeof handler !== 'function') {
      throw new Error('handler must be a function')
    }

    if (typeof done !== 'function') {
      throw new Error('the callback must be a function')
    }

    const req = this.req

    const stream = multipartReadStream(req.headers, handler)

    pump(req, stream, done)
  }
}

module.exports = fp(fastifyMultipart, '>= 0.15.0')
