'use strict'

const fp = require('fastify-plugin')
const multipartReadStream = require('multipart-read-stream')
const pump = require('pump')
const kMultipart = Symbol('multipart')

function setMultipart (req, done) {
  // nothing to do, it will be done by the Request.multipart object
  req[kMultipart] = true
  done()
}

function fastifyMultipart (fastify, options, done) {
  fastify.addContentTypeParser('multipart', setMultipart)

  fastify.decorateRequest('multipart', multipart)
  fastify.decorateRequest('isMultipart', isMultipart)

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

    if (!this.isMultipart()) {
      done(new Error('the request is not multipart'))
      return
    }

    const log = this.log

    log.debug('starting multipart parsing')

    const req = this.req

    const stream = multipartReadStream(req.headers, wrap)

    pump(req, stream, done)

    function wrap (field, file, filename, encoding, mimetype) {
      log.debug({ field, filename, encoding, mimetype }, 'parsing part')
      handler(field, file, filename, encoding, mimetype)
    }

    return stream
  }

  function isMultipart () {
    return this.req[kMultipart] || false
  }
}

module.exports = fp(fastifyMultipart, '>= 0.33.0')
