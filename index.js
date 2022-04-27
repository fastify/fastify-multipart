'use strict'

const Busboy = require('@fastify/busboy')
const os = require('os')
const fp = require('fastify-plugin')
const eos = require('end-of-stream')
const { createWriteStream } = require('fs')
const { unlink } = require('fs').promises
const path = require('path')
const hexoid = require('hexoid')
const util = require('util')
const createError = require('@fastify/error')
const sendToWormhole = require('stream-wormhole')
const deepmerge = require('deepmerge')
const { PassThrough, pipeline } = require('stream')
const pump = util.promisify(pipeline)
const secureJSON = require('secure-json-parse')

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
    if (key === '__proto__' || key === 'constructor') {
      mp.destroy(new Error(`${key} is not allowed as field name`))
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

  if (options.attachFieldsToBody === true) {
    if (typeof options.sharedSchemaId === 'string') {
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
      if (!req.isMultipart()) {
        return
      }
      for await (const part of req.parts()) {
        req.body = part.fields
        if (part.file) {
          if (options.onFile) {
            await options.onFile(part)
          } else {
            await part.toBuffer()
          }
        }
      }
    })
  }

  let throwFileSizeLimit = true
  if (typeof options.throwFileSizeLimit === 'boolean') {
    throwFileSizeLimit = options.throwFileSizeLimit
  }

  const PartsLimitError = createError('FST_PARTS_LIMIT', 'reach parts limit', 413)
  const FilesLimitError = createError('FST_FILES_LIMIT', 'reach files limit', 413)
  const FieldsLimitError = createError('FST_FIELDS_LIMIT', 'reach fields limit', 413)
  const RequestFileTooLargeError = createError('FST_REQ_FILE_TOO_LARGE', 'request file too large, please check multipart config', 413)
  const PrototypeViolationError = createError('FST_PROTO_VIOLATION', 'prototype property is not allowed as field name', 400)
  const InvalidMultipartContentTypeError = createError('FST_INVALID_MULTIPART_CONTENT_TYPE', 'the request is not multipart', 406)
  const InvalidJSONFieldError = createError('FST_INVALID_JSON_FIELD_ERROR', 'a request field is not a valid JSON as declared by its Content-Type', 406)

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

  fastify.decorateRequest('parts', getMultipartIterator)

  fastify.decorateRequest('isMultipart', isMultipart)
  fastify.decorateRequest('tmpUploads', null)

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

    log.warn('the multipart callback-based api is deprecated in favour of the new promise api')
    log.debug('starting multipart parsing')

    const req = this.raw

    const busboyOptions = deepmerge.all([{ headers: Object.assign({}, req.headers) }, options || {}, opts || {}])
    const stream = busboy(busboyOptions)
    let completed = false
    let files = 0

    req.on('error', function (err) {
      stream.destroy()
      if (!completed) {
        completed = true
        done(err)
      }
    })

    stream.on('finish', function () {
      log.debug('finished receiving stream, total %d files', files)
      if (!completed) {
        completed = true
        setImmediate(done)
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
      if (field === '__proto__' || field === 'constructor') {
        file.destroy(new Error(`${field} is not allowed as field name`))
        return
      }
      handler(field, file, filename, encoding, mimetype)
    }

    function waitForFiles (err) {
      if (err) {
        completed = true
        done(err)
      }
    }

    return stream
  }

  function handleMultipart (opts = {}) {
    if (!this.isMultipart()) {
      throw new InvalidMultipartContentTypeError()
    }

    this.log.debug('starting multipart parsing')

    let values = []
    let pendingHandler = null

    // only one file / field can be processed at a time
    // "null" will close the consumer side
    const ch = (val) => {
      if (pendingHandler) {
        pendingHandler(val)
        pendingHandler = null
      } else {
        values.push(val)
      }
    }

    const handle = (handler) => {
      if (values.length > 0) {
        const value = values[0]
        values = values.slice(1)
        handler(value)
      } else {
        pendingHandler = handler
      }
    }

    const parts = () => {
      return new Promise((resolve, reject) => {
        handle((val) => {
          if (val instanceof Error) return reject(val)
          resolve(val)
        })
      })
    }

    const body = {}
    let lastError = null
    let currentFile = null
    const request = this.raw
    const busboyOptions = deepmerge.all([
      { headers: Object.assign({}, request.headers) },
      options,
      opts
    ])

    this.log.trace({ busboyOptions }, 'Providing options to busboy')
    const bb = busboy(busboyOptions)

    request.on('close', cleanup)
    request.on('error', cleanup)

    bb
      .on('field', onField)
      .on('file', onFile)
      .on('close', cleanup)
      .on('error', onEnd)
      .on('end', onEnd)
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

    function onField (name, fieldValue, fieldnameTruncated, valueTruncated, encoding, contentType) {
      let mimetype

      // don't overwrite prototypes
      if (getDescriptor(Object.prototype, name)) {
        onError(new PrototypeViolationError())
        return
      }

      // If it is a JSON field, parse it
      if (contentType.startsWith('application/json')) {
        // If the value was truncated, it can never be a valid JSON. Don't even try to parse
        if (valueTruncated) {
          onError(new InvalidJSONFieldError())
          return
        }

        try {
          fieldValue = secureJSON.parse(fieldValue)
          mimetype = 'application/json'
        } catch (e) {
          onError(new InvalidJSONFieldError())
          return
        }
      }

      const value = {
        fieldname: name,
        mimetype,
        encoding,
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

      if (typeof opts.throwFileSizeLimit === 'boolean') {
        throwFileSizeLimit = opts.throwFileSizeLimit
      }

      const value = {
        fieldname: name,
        filename,
        encoding,
        mimetype,
        file,
        fields: body,
        _buf: null,
        async toBuffer () {
          if (this._buf) {
            return this._buf
          }
          const fileChunks = []
          for await (const chunk of this.file) {
            fileChunks.push(chunk)

            if (throwFileSizeLimit && this.file.truncated) {
              const err = new RequestFileTooLargeError()
              err.part = this

              onError(err)
              throw err
            }
          }
          this._buf = Buffer.concat(fileChunks)
          return this._buf
        }
      }

      if (throwFileSizeLimit) {
        file.on('limit', function () {
          const err = new RequestFileTooLargeError()
          err.part = value
          onError(err)
        })
      }

      if (body[name] === undefined) {
        body[name] = value
      } else if (Array.isArray(body[name])) {
        body[name].push(value)
      } else {
        body[name] = [body[name], value]
      }
      currentFile = file
      ch(value)
    }

    function onError (err) {
      lastError = err
      currentFile = null
    }

    function onEnd (err) {
      cleanup()

      ch(err || lastError)
    }

    function cleanup (err) {
      request.unpipe(bb)
      // in node 10 it seems that error handler is not called but request.aborted is set
      if ((err || request.aborted) && currentFile) {
        currentFile.destroy()
      }
    }

    return parts
  }

  async function saveRequestFiles (options) {
    const requestFiles = []
    const tmpdir = (options && options.tmpdir) || os.tmpdir()

    const files = await this.files(options)
    this.tmpUploads = []
    for await (const file of files) {
      const filepath = path.join(tmpdir, toID() + path.extname(file.filename))
      const target = createWriteStream(filepath)
      try {
        await pump(file.file, target)
        requestFiles.push({ ...file, filepath })
        this.tmpUploads.push(filepath)
      } catch (err) {
        this.log.error({ err }, 'save request file')
        throw err
      }
    }

    return requestFiles
  }

  async function cleanRequestFiles () {
    if (!this.tmpUploads) {
      return
    }
    for (const filepath of this.tmpUploads) {
      try {
        await unlink(filepath)
      } catch (error) {
        this.log.error(error, 'could not delete file')
      }
    }
  }

  async function getMultipartFile (options) {
    const parts = this[kMultipartHandler](options)
    let part
    while ((part = await parts()) != null) {
      if (part.file) {
        // part.file.truncated is true when a configured file size limit is reached
        if (part.file.truncated && throwFileSizeLimit) {
          throw new RequestFileTooLargeError()
        }
        return part
      }
    }
  }

  async function * getMultipartFiles (options) {
    const parts = this[kMultipartHandler](options)

    let part
    while ((part = await parts()) != null) {
      if (part.file) {
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
