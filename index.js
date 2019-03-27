'use strict'

const fp = require('fastify-plugin')
const Busboy = require('busboy')
const kMultipart = Symbol('multipart')
const eos = require('end-of-stream')
const deepmerge = require('deepmerge')

function setMultipart (req, done) {
  // nothing to do, it will be done by the Request.multipart object
  req[kMultipart] = true
  done()
}

function attachToBody (options, req, reply, next) {
  req[kMultipart] = true

  const body = { }
  const mp = req.multipart((field, file, filename, encoding, mimetype) => {
    body[field] = {
      // stream: file,
      data: [],
      filename,
      encoding,
      mimetype,
      limit: false
    }

    const fileData = []
    const isCustomDataConsumer = typeof options.onData === 'function'
    const onData = isCustomDataConsumer
      ? options.onData
      : (fieldName, data) => { fileData.push(data) }

    file.on('data', (data) => { onData(field, data) })
    file.on('limit', () => { body[field].limit = true })

    file.on('end', () => {
      if (!isCustomDataConsumer) {
        body[field].data = Buffer.concat(fileData.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part)))
      }
    })
  }, function (err) {
    req.body = body
    next(err)
  })

  mp.on('field', (key, value) => {
    body[key] = value
  })
}

function fastifyMultipart (fastify, options, done) {
  if (options.addToBody === true) {
    if (typeof options.sharedSchemaId === 'string') {
      fastify.addSchema({
        $id: options.sharedSchemaId,
        type: 'object',
        properties: {
          encoding: { type: 'string' },
          filename: { type: 'string' },
          limit: { type: 'boolean' },
          mimetype: { type: 'string' }
        }
      })
    }

    fastify.addHook('preValidation', function (req, reply, next) {
      attachToBody(options, req, reply, next)
    })
  }
  fastify.addContentTypeParser('multipart', setMultipart)

  fastify.decorateRequest('multipart', multipart)
  fastify.decorateRequest('isMultipart', isMultipart)

  done()

  // handler definition is in multipart-readstream
  // handler(field, file, filename, encoding, mimetype)
  // opts is a per-request override for the options object
  function multipart (handler, done, opts) {
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

    const busboyOptions = deepmerge.all([{ headers: req.headers }, options || {}, opts || {}])
    const stream = new Busboy(busboyOptions)
    var completed = false
    var files = 0
    var count = 0
    var callDoneOnNextEos = false

    req.on('error', function (err) {
      stream.destroy()
      if (!completed) {
        completed = true
        done(err)
      }
    })

    stream.on('finish', function () {
      log.debug('finished multipart parsing')
      if (!completed && count === files) {
        completed = true
        setImmediate(done)
      } else {
        callDoneOnNextEos = true
      }
    })

    stream.on('file', wrap)

    req.pipe(stream)

    function wrap (field, file, filename, encoding, mimetype) {
      log.debug({ field, filename, encoding, mimetype }, 'parsing part')
      files++
      eos(file, waitForFiles)
      handler(field, file, filename, encoding, mimetype)
    }

    function waitForFiles (err) {
      if (err) {
        completed = true
        done(err)
        return
      }

      if (completed) {
        return
      }

      ++count
      if (callDoneOnNextEos && count === files) {
        completed = true
        done()
      }
    }

    return stream
  }

  function isMultipart () {
    return this.req[kMultipart] || false
  }
}

module.exports = fp(fastifyMultipart, {
  fastify: '>= 0.39.0',
  name: 'fastify-multipart'
})
