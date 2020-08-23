const Busboy = require('busboy')
const os = require('os')
const concat = require('concat-stream')
const fp = require('fastify-plugin')
const eos = require('end-of-stream')
const { createWriteStream } = require('fs')
const { unlink } = require('fs').promises
const path = require('path')
const hexoid = require('hexoid')
const util = require('util')
const createError = require('fastify-error')
const sendToWormhole = require('stream-wormhole')
const deepmerge = require('deepmerge')
const { PassThrough, pipeline } = require('stream')
const pump = util.promisify(pipeline)

const kMultipart = Symbol('multipart')
const kMultipartHandler = Symbol('multipartHandler')
const getDescriptor = Object.getOwnPropertyDescriptor

function setMultipart (req, payload, done) {
  // nothing to do, it will be done by the Request.multipart object
  req.raw[kMultipart] = true
  done()
}

function attachToBody (options, req, reply, next) {
  if (req.raw[kMultipart] !== true) {
    next()
    return
  }

  const consumerStream = options.onFile || defaultConsumer
  const body = {}
  const mp = req.multipart((field, file, filename, encoding, mimetype) => {
    body[field] = body[field] || []
    body[field].push({
      data: [],
      filename,
      encoding,
      mimetype,
      limit: false
    })

    const result = consumerStream(field, file, filename, encoding, mimetype, body)
    if (result && typeof result.then === 'function') {
      result.catch((err) => {
        // continue with the workflow
        err.statusCode = 500
        file.destroy(err)
      })
    }
  }, function (err) {
    if (!err) {
      req.body = body
    }
    next(err)
  }, options)

  mp.on('field', (key, value) => {
    if (key === '__proto__') {
      mp.destroy(new Error('__proto__ is not allowed as field name'))
      return
    }
    if (body[key] === undefined) {
      body[key] = value
    } else if (Array.isArray(body[key])) {
      body[key].push(value)
    } else {
      body[key] = [body[key], value]
    }
  })
}

function defaultConsumer (field, file, filename, encoding, mimetype, body) {
  const fileData = []
  const lastFile = body[field][body[field].length - 1]
  file.on('data', data => { if (!lastFile.limit) { fileData.push(data) } })
  file.on('limit', () => { lastFile.limit = true })
  file.on('end', () => {
    if (!lastFile.limit) {
      lastFile.data = Buffer.concat(fileData)
    } else {
      lastFile.data = undefined
    }
  })
}

function busboy (options) {
  try {
    return new Busboy(options)
  } catch (error) {
    const errorEmitter = new PassThrough()
    process.nextTick(function () {
      errorEmitter.emit('error', error)
    })
    return errorEmitter
  }
}

function fastifyMultipart (fastify, options = {}, done) {
  if (options.addToBody === true) {
    if (typeof options.sharedSchemaId === 'string') {
      console.log('#################222222222222222222')
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

  if (options.attachFieldsToBody === true || options.onFile) {
    if (typeof options.sharedSchemaId === 'string') {
      console.log('#################11111111111', (new Error()).stack)
      fastify.addSchema({
        $id: options.sharedSchemaId,
        type: 'object',
        properties: {
          fieldname: { type: 'string' },
          encoding: { type: 'string' },
          filename: { type: 'string' },
          mimetype: { type: 'string' }
        }
      })
    }
    fastify.addHook('preValidation', async function (req, reply) {
      for await (const part of req.multipartIterator()) {
        req.body = part.fields
        if (part.file) {
          if (options.onFile) {
            await options.onFile(part)
          } else {
            await part.buffer()
          }
        }
      }
    })
  }

  const PartsLimitError = createError('FST_PARTS_LIMIT', 'reach parts limit', 413)
  const FilesLimitError = createError('FST_FILES_LIMIT', 'reach files limit', 413)
  const FieldsLimitError = createError('FST_FIELDS_LIMIT', 'reach fields limit', 413)
  const RequestFileTooLargeError = createError('FST_REQ_FILE_TOO_LARGE', 'request file too large, please check multipart config', 413)
  const PrototypeViolationError = createError('FST_PROTO_VIOLATION', 'prototype property is not allowed as field name', 400)
  const InvalidMultipartContentTypeError = createError('FST_INVALID_MULTIPART_CONTENT_TYPE', 'the request is not multipart', 406)

  fastify.decorate('multipartErrors', {
    PartsLimitError,
    FilesLimitError,
    FieldsLimitError,
    PrototypeViolationError,
    InvalidMultipartContentTypeError,
    RequestFileTooLargeError
  })

  fastify.addContentTypeParser('multipart', setMultipart)
  fastify.decorateRequest(kMultipartHandler, handleMultipart)
  fastify.decorateRequest('multipartIterator', getMultipartIterator)
  fastify.decorateRequest('isMultipart', isMultipart)
  fastify.decorateRequest('tmpUploads', [])

  // legacy
  fastify.decorateRequest('multipart', handleLegacyMultipartApi)

  // Stream mode
  fastify.decorateRequest('file', getMultipartFile)
  fastify.decorateRequest('files', getMultipartFiles)

  // Disk mode
  fastify.decorateRequest('saveRequestFiles', saveRequestFiles)
  fastify.decorateRequest('cleanRequestFiles', cleanRequestFiles)

  fastify.addHook('onResponse', async (request, reply) => {
    await request.cleanRequestFiles()
  })

  const toID = hexoid()

  function isMultipart () {
    return this.raw[kMultipart] || false
  }

  // handler definition is in multipart-readstream
  // handler(field, file, filename, encoding, mimetype)
  // opts is a per-request override for the options object
  function handleLegacyMultipartApi (handler, done, opts) {
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

    const req = this.raw

    const busboyOptions = deepmerge.all([{ headers: req.headers }, options || {}, opts || {}])
    const stream = busboy(busboyOptions)
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
      log.debug('finished receiving stream, total %d files', files)
      if (!completed && count === files) {
        completed = true
        setImmediate(done)
      } else {
        callDoneOnNextEos = true
      }
    })

    stream.on('file', wrap)

    req.pipe(stream)
      .on('error', function (error) {
        req.emit('error', error)
      })

    function wrap (field, file, filename, encoding, mimetype) {
      log.debug({ field, filename, encoding, mimetype }, 'parsing part')
      files++
      eos(file, waitForFiles)
      if (field === '__proto__') {
        file.destroy(new Error('__proto__ is not allowed as field name'))
        return
      }
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

  function handleMultipart (opts = {}) {
    if (!this.isMultipart()) {
      throw new InvalidMultipartContentTypeError()
    }

    let worker
    let lastValue

    // only one file / field can be processed at a time
    // "null" will close the consumer side
    const ch = (val) => {
      if (typeof val === 'function') {
        worker = val
      } else {
        lastValue = val
      }
      if (worker && lastValue !== undefined) {
        worker(lastValue)
        worker = undefined
        lastValue = undefined
      }
    }
    const parts = () => {
      return new Promise((resolve, reject) => {
        ch((val) => {
          if (val instanceof Error) return reject(val)
          resolve(val)
        })
      })
    }

    const body = {}
    let lastError = null
    const request = this.raw
    const busboyOptions = deepmerge.all([
      { headers: request.headers },
      options,
      opts
    ])

    const bb = busboy(busboyOptions)

    request.on('close', cleanup)

    bb
      .on('field', onField)
      .on('file', onFile)
      .on('close', cleanup)
      .on('error', onEnd)
      .on('finish', onEnd)

    bb.on('partsLimit', function () {
      onError(new PartsLimitError())
    })

    bb.on('filesLimit', function () {
      onError(new FilesLimitError())
    })

    bb.on('fieldsLimit', function () {
      onError(new FieldsLimitError())
    })

    request.pipe(bb)

    function onField (name, fieldValue, fieldnameTruncated, valueTruncated) {
      // don't overwrite prototypes
      if (getDescriptor(Object.prototype, name)) {
        onError(new PrototypeViolationError())
        return
      }

      const value = {
        fieldname: name,
        value: fieldValue,
        fieldnameTruncated,
        valueTruncated,
        fields: body
      }

      if (body[name] === undefined) {
        body[name] = value
      } else if (Array.isArray(body[name])) {
        body[name].push(value)
      } else {
        body[name] = [body[name], value]
      }

      ch(value)
    }

    function onFile (name, file, filename, encoding, mimetype) {
      // don't overwrite prototypes
      if (getDescriptor(Object.prototype, name)) {
        // ensure that stream is consumed, any error is suppressed
        sendToWormhole(file)
        onError(new PrototypeViolationError())
        return
      }

      const value = {
        fieldname: name,
        filename,
        encoding,
        mimetype,
        file,
        fields: body,
        _buf: null,
        buffer () {
          if (this._buf) {
            return Promise.resolve(this._buf)
          }
          return new Promise((resolve, reject) => {
            pump(this.file, concat((buf) => {
              this._buf = buf
              resolve(this._buf)
            })).catch(reject)
          })
        }
      }
      if (body[name] === undefined) {
        body[name] = value
      } else if (Array.isArray(body[name])) {
        body[name].push(value)
      } else {
        body[name] = [body[name], value]
      }

      ch(value)
    }

    function onError (err) {
      lastError = err
    }

    function onEnd (error) {
      cleanup()
      bb.removeListener('finish', onEnd)
      bb.removeListener('error', onEnd)
      ch(error || lastError)
    }

    function cleanup () {
      // keep finish listener to wait all data flushed
      // keep error listener to wait stream error
      request.removeListener('close', cleanup)
      bb.removeListener('field', onField)
      bb.removeListener('file', onFile)
      bb.removeListener('close', cleanup)
    }

    return parts
  }

  async function handlePartFile (part, logger) {
    const file = part.file
    if (file.truncated) {
      // ensure that stream is consumed, any error is suppressed
      await sendToWormhole(file)
      // throw on consumer side
      return Promise.reject(new RequestFileTooLargeError())
    }

    file.once('limit', () => {
      const err = new RequestFileTooLargeError()

      if (file.listenerCount('error') > 0) {
        file.emit('error', err)
        logger.warn(err)
      } else {
        logger.error(err)
        // ignore next error event
        file.on('error', () => { })
      }
      // ignore all data
      file.resume()
    })

    return part
  }

  async function saveRequestFiles (options) {
    const requestFiles = []

    const files = await this.files(options)
    for await (const file of files) {
      const filepath = path.join(os.tmpdir(), toID() + '_' + path.extname(file.filename))
      const target = createWriteStream(filepath)
      try {
        await pump(file.file, target)
        this.tmpUploads.push(filepath)
        requestFiles.push({ ...file, filepath })
      } catch (error) {
        this.log.error(error)
        await unlink(filepath)
      }
    }

    return requestFiles
  }

  async function cleanRequestFiles () {
    for (const filepath of this.tmpUploads) {
      try {
        await unlink(filepath)
      } catch (error) {
        this.log.error(error)
      }
    }
  }

  async function getMultipartFile (options) {
    const parts = this[kMultipartHandler](options)

    let part
    while ((part = await parts()) != null) {
      if (part.file) {
        return handlePartFile(part, this.log)
      }
    }
  }

  async function * getMultipartFiles (options) {
    const parts = this[kMultipartHandler](options)

    let part
    while ((part = await parts()) != null) {
      if (part.file) {
        part = await handlePartFile(part, this.log)
        yield part
      }
    }
  }

  async function * getMultipartIterator (options) {
    const parts = this[kMultipartHandler](options)

    let part
    while ((part = await parts()) != null) {
      yield part
    }
  }

  done()
}

module.exports = fp(fastifyMultipart, {
  fastify: '>= 0.39.0',
  name: 'fastify-multipart'
})
