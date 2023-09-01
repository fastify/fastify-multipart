'use strict'

const Busboy = require('@fastify/busboy')
const os = require('os')
const fp = require('fastify-plugin')
const { createWriteStream } = require('fs')
const { unlink } = require('fs').promises
const path = require('path')
const { generateId } = require('./lib/generateId')
const util = require('util')
const createError = require('@fastify/error')
const sendToWormhole = require('stream-wormhole')
const deepmergeAll = require('@fastify/deepmerge')({ all: true })
const { PassThrough, pipeline, Readable } = require('stream')
const pump = util.promisify(pipeline)
const secureJSON = require('secure-json-parse')

const kMultipart = Symbol('multipart')
const kMultipartHandler = Symbol('multipartHandler')
const getDescriptor = Object.getOwnPropertyDescriptor

const PartsLimitError = createError('FST_PARTS_LIMIT', 'reach parts limit', 413)
const FilesLimitError = createError('FST_FILES_LIMIT', 'reach files limit', 413)
const FieldsLimitError = createError('FST_FIELDS_LIMIT', 'reach fields limit', 413)
const RequestFileTooLargeError = createError('FST_REQ_FILE_TOO_LARGE', 'request file too large', 413)
const PrototypeViolationError = createError('FST_PROTO_VIOLATION', 'prototype property is not allowed as field name', 400)
const InvalidMultipartContentTypeError = createError('FST_INVALID_MULTIPART_CONTENT_TYPE', 'the request is not multipart', 406)
const InvalidJSONFieldError = createError('FST_INVALID_JSON_FIELD_ERROR', 'a request field is not a valid JSON as declared by its Content-Type', 406)
const FileBufferNotFoundError = createError('FST_FILE_BUFFER_NOT_FOUND', 'the file buffer was not found', 500)

function setMultipart (req, payload, done) {
  req.raw[kMultipart] = true
  done()
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
  options.limits = {
    ...options.limits,
    parts: options.limits?.parts || 1000,
    fileSize: options.limits?.fileSize || fastify.initialConfig.bodyLimit
  }

  const attachFieldsToBody = options.attachFieldsToBody

  if (attachFieldsToBody === true || attachFieldsToBody === 'keyValues') {
    if (typeof options.sharedSchemaId === 'string' && attachFieldsToBody === true) {
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
            await options.onFile.call(req, part)
          } else {
            await part.toBuffer()
          }
        }
      }

      if (attachFieldsToBody === 'keyValues') {
        const body = {}

        if (req.body) {
          const reqBodyKeys = Object.keys(req.body)

          for (let i = 0; i < reqBodyKeys.length; ++i) {
            const key = reqBodyKeys[i]
            const field = req.body[key]

            if (field.value !== undefined) {
              body[key] = field.value
            } else if (field._buf) {
              body[key] = field._buf
            } else if (Array.isArray(field)) {
              const items = []

              for (let i = 0; i < field.length; ++i) {
                const item = field[i]

                if (item.value !== undefined) {
                  items.push(item.value)
                } else if (item._buf) {
                  items.push(item._buf)
                }
              }

              if (items.length) {
                body[key] = items
              }
            }
          }
        }

        req.body = body
      }
    })
  }

  const defaultThrowFileSizeLimit = typeof options.throwFileSizeLimit === 'boolean'
    ? options.throwFileSizeLimit
    : true

  fastify.decorate('multipartErrors', {
    PartsLimitError,
    FilesLimitError,
    FieldsLimitError,
    PrototypeViolationError,
    InvalidMultipartContentTypeError,
    RequestFileTooLargeError,
    FileBufferNotFoundError
  })

  fastify.addContentTypeParser('multipart/form-data', setMultipart)
  fastify.decorateRequest(kMultipartHandler, handleMultipart)

  fastify.decorateRequest('parts', getMultipartIterator)

  fastify.decorateRequest('isMultipart', isMultipart)
  fastify.decorateRequest('tmpUploads', null)
  fastify.decorateRequest('savedRequestFiles', null)

  // Stream mode
  fastify.decorateRequest('file', getMultipartFile)
  fastify.decorateRequest('files', getMultipartFiles)

  // Disk mode
  fastify.decorateRequest('saveRequestFiles', saveRequestFiles)
  fastify.decorateRequest('cleanRequestFiles', cleanRequestFiles)

  fastify.addHook('onResponse', async (request, reply) => {
    await request.cleanRequestFiles()
  })

  function isMultipart () {
    return this.raw[kMultipart]
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
    const busboyOptions = deepmergeAll(
      { headers: request.headers },
      options,
      opts
    )

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
      const err = new PartsLimitError()
      onError(err)
      process.nextTick(() => onEnd(err))
    })

    bb.on('filesLimit', function () {
      const err = new FilesLimitError()
      onError(err)
      process.nextTick(() => onEnd(err))
    })

    bb.on('fieldsLimit', function () {
      const err = new FieldsLimitError()
      onError(err)
      process.nextTick(() => onEnd(err))
    })

    request.pipe(bb)

    function onField (name, fieldValue, fieldnameTruncated, valueTruncated, encoding, contentType) {
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
          contentType = 'application/json'
        } catch (e) {
          onError(new InvalidJSONFieldError())
          return
        }
      }

      const value = {
        type: 'field',
        fieldname: name,
        mimetype: contentType,
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

      const throwFileSizeLimit = typeof opts.throwFileSizeLimit === 'boolean'
        ? opts.throwFileSizeLimit
        : defaultThrowFileSizeLimit

      const value = {
        type: 'file',
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
          let err
          for await (const chunk of this.file) {
            fileChunks.push(chunk)

            if (throwFileSizeLimit && this.file.truncated) {
              err = new RequestFileTooLargeError()
              err.part = this

              onError(err)
              fileChunks.length = 0
            }
          }
          if (err) {
            // throwing in the async iterator will
            // cause the file.destroy() to be called
            // The stream has already been managed by
            // busboy instead
            throw err
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
    // Checks if this has already been run
    if (this.savedRequestFiles) {
      return this.savedRequestFiles
    }
    let files
    if (attachFieldsToBody === true) {
      // Skip the whole process if the body is empty
      if (!this.body) {
        return []
      }
      files = filesFromFields.call(this, this.body)
    } else {
      files = await this.files(options)
    }
    this.savedRequestFiles = []
    const tmpdir = (options && options.tmpdir) || os.tmpdir()
    this.tmpUploads = []
    for await (const file of files) {
      const filepath = path.join(tmpdir, generateId() + path.extname(file.filename))
      const target = createWriteStream(filepath)
      try {
        await pump(file.file, target)
        this.savedRequestFiles.push({ ...file, filepath })
        this.tmpUploads.push(filepath)
      } catch (err) {
        this.log.error({ err }, 'save request file')
        throw err
      }
    }

    return this.savedRequestFiles
  }

  function * filesFromFields (container) {
    try {
      for (const field of Object.values(container)) {
        if (Array.isArray(field)) {
          for (const subField of filesFromFields.call(this, field)) {
            yield subField
          }
        }
        if (!field.file) {
          continue
        }
        if (!field._buf) {
          throw new FileBufferNotFoundError()
        }
        field.file = Readable.from(field._buf)
        yield field
      }
    } catch (err) {
      this.log.error({ err }, 'save request file failed')
      throw err
    }
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

/**
 * Adds a new type `isFile` to help @fastify/swagger generate the correct schema.
 */
function ajvFilePlugin (ajv) {
  return ajv.addKeyword({
    keyword: 'isFile',
    compile: (_schema, parent) => {
      // Updates the schema to match the file type
      parent.type = 'string'
      parent.format = 'binary'
      delete parent.isFile

      return (field /* MultipartFile */) => !!field.file
    },
    error: {
      message: 'should be a file'
    }
  })
}

/**
 * These export configurations enable JS and TS developers
 * to consumer fastify in whatever way best suits their needs.
 */
module.exports = fp(fastifyMultipart, {
  fastify: '4.x',
  name: '@fastify/multipart'
})
module.exports.default = fastifyMultipart
module.exports.fastifyMultipart = fastifyMultipart
module.exports.ajvFilePlugin = ajvFilePlugin
