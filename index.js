const Busboy = require('busboy')
const os = require('os')
const concat = require('concat-stream')
const fp = require('fastify-plugin')
const eos = require('end-of-stream')
const { createWriteStream } = require('fs')
const { unlink } = require('fs').promises
const path = require('path')
const uuid = require('uuid')
const util = require('util')
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
    log.warn('this api is deprecated. Please use the new api.')

    const req = this.raw

    const busboyOptions = deepmerge.all([{ headers: req.headers }, options || {}, opts || {}])
    const stream = busboy(busboyOptions)
    var completed = false
    var files = 0
    var count = 0
    var callDoneOnNextEos = false
    var lastError

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
        setImmediate(() => done(lastError))
      } else {
        callDoneOnNextEos = true
      }
    })

    stream.on('file', wrap)
    // handle busboy parsing errors e.g (Multipart: Boundary not found)
    stream.on('error', (err) => {
      completed = true
      setImmediate(() => done(err))
    })

    req.pipe(stream)
      .on('error', (error) => {
        lastError = error
      })

    function wrap (field, file, filename, encoding, mimetype) {
      log.debug({ field, filename, encoding, mimetype }, 'parsing part')
      files++
      eos(file, waitForFiles)
      if (field === '__proto__') {
        // ignore all data, stream is consumed and any error is suppressed
        sendToWormhole(file)
        lastError = new Error('__proto__ is not allowed as field name')
        return
      }
      handler(field, file, filename, encoding, mimetype)
    }

    function waitForFiles (err) {
      if (err) {
        // ignore all data, busboy only emits finish when all streams were consumed
        this.resume()
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
      throw new Error('the request is not multipart')
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
      const err = new Error('Reach parts limit')
      err.code = 'Request_parts_limit'
      err.status = 413
      onError(err)
    })

    bb.on('filesLimit', function () {
      const err = new Error('Reach files limit')
      err.code = 'Request_files_limit'
      err.status = 413
      onError(err)
    })

    bb.on('fieldsLimit', function () {
      const err = new Error('Reach fields limit')
      err.code = 'Request_fields_limit'
      err.status = 413
      onError(err)
    })

    request.pipe(bb)

    function onField (name, fieldValue, fieldnameTruncated, valueTruncated) {
      // don't overwrite prototypes
      if (getDescriptor(Object.prototype, name)) {
        const err = new Error('prototype property is not allowed as field name')
        err.code = 'Prototype_violation'
        onError(err)
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
        const err = new Error('prototype property is not allowed as field name')
        err.code = 'Prototype_violation'
        err.status = 413
        // ignore all data, stream is consumed and any error is suppressed
        sendToWormhole(file)
        onError(err)
        return
      }

      const value = {
        fieldname: name,
        filename,
        encoding,
        mimetype,
        file,
        fields: body,
        get content () {
          return new Promise((resolve, reject) => {
            pump(this.file, concat(resolve)).catch(reject)
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
      const err = new Error('Request file too large, please check multipart config')
      err.code = 'File_Too_Large'
      err.status = 413
      await sendToWormhole(file)
      // throw on consumer side
      return Promise.reject(err)
    }

    file.once('limit', () => {
      const err = new Error('Request file too large, please check multipart config')
      err.code = 'File_Too_Large'
      err.status = 413

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
      const filepath = path.join(os.tmpdir(), uuid.v4() + path.extname(file.filename))
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
