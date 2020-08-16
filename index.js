const Busboy = require('busboy')
const os = require('os')
const fp = require('fastify-plugin')
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
const kMultipartFilePaths = Symbol('multipart.filePaths')
const kMultipartHasParsed = Symbol('multipart.hasParsed')
const getDescriptor = Object.getOwnPropertyDescriptor

function setMultipart (req, payload, done) {
  // nothing to do, it will be done by the Request.multipart object
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

function fastifyMultipart (fastify, options = {}, done) {
  fastify.addContentTypeParser('multipart', setMultipart)
  fastify.decorateRequest('handleMultipart', handleMultipart)
  fastify.decorateRequest('multipart', getMultipartIterator)
  fastify.decorateRequest('isMultipart', isMultipart)
  fastify.decorateRequest(kMultipartFilePaths, [])
  fastify.decorateRequest(kMultipartHasParsed, false)

  // Stream mode
  fastify.decorateRequest('file', getMultipartFile)
  fastify.decorateRequest('files', getMultipartFiles)

  // Disk mode
  fastify.decorateRequest('saveRequestFiles', saveRequestFiles)
  fastify.decorateRequest('cleanRequestFiles', cleanRequestFiles)

  fastify.addHook('onError', async (request, reply, error) => {
    await request.cleanRequestFiles()
  })
  fastify.addHook('onResponse', async (request, reply) => {
    await request.cleanRequestFiles()
  })

  function isMultipart () {
    return this.raw[kMultipart] || false
  }

  function handleMultipart (opts = {}) {
    if (!this.isMultipart()) {
      throw new Error('the request is not multipart')
    }

    if (this[kMultipartHasParsed]) {
      throw new Error('multipart can not be called twice on the same request')
    }

    this[kMultipartHasParsed] = true

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
        onError(new Error('prototype property is not allowed as field name'))
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
        // ignore all data
        sendToWormhole(file)
        onError(new Error('prototype property is not allowed as field name'))
        return
      }

      const value = {
        fieldname: name,
        filename,
        encoding,
        mimetype,
        file,
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

  async function saveRequestFiles () {
    const requestFiles = []

    const files = await this.files()
    for await (const file of files) {
      const filepath = path.join(os.tmpdir(), uuid.v4() + path.extname(file.filename))
      const target = createWriteStream(filepath)
      try {
        await pump(file.file, target)
        this[kMultipartFilePaths].push(filepath)
        requestFiles.push({ ...file, filepath })
      } catch (error) {
        this.log.error(error)
        await unlink(filepath)
      }
    }

    return requestFiles
  }

  async function cleanRequestFiles () {
    for (const filepath of this[kMultipartFilePaths]) {
      try {
        await unlink(filepath)
      } catch (error) {
        this.log.error(error)
      }
    }
  }

  function getMultipartFile (options) {
    const parts = this.handleMultipart(options)
    return parts()
  }

  async function * getMultipartFiles (options) {
    const parts = this.handleMultipart(options)

    let part
    while ((part = await parts()) != null) {
      if (part.file) {
        const file = part.file

        if (file.truncated) {
          const err = new Error('Request file too large, please check multipart config')
          err.name = 'MultipartFileTooLargeError'
          err.status = 413
          await sendToWormhole(file)
          // throw on consumer side
          yield Promise.reject(err)
        } else {
          file.once('limit', () => {
            const err = new Error('Request file too large, please check multipart config')
            err.name = 'MultipartFileTooLargeError'
            err.status = 413

            if (file.listenerCount('error') > 0) {
              file.emit('error', err)
              this.log.warn(err)
            } else {
              this.log.error(err)
              // ignore next error event
              file.on('error', () => { })
            }
            // ignore all data
            file.resume()
          })

          yield part
        }
      }
    }
  }

  async function * getMultipartIterator (options) {
    const parts = this.handleMultipart(options)

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
