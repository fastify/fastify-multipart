'use strict'

const util = require('util')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { Readable } = require('readable-stream')
const stream = require('stream')
const pump = util.promisify(stream.pipeline)
const sendToWormhole = require('stream-wormhole')

const filePath = path.join(__dirname, '../README.md')

test('should throw fileSize limitation error on small payload', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      // eslint-disable-next-line
      for await (const _ of req.files({ limits: { fileSize: 2 } })) {
        t.fail('should not be called')
      }
      reply.code(200).send()
    } catch (error) {
      t.equal(error.message, 'Request file too large, please check multipart config')
      reply.code(500).send()
    }
  })

  fastify.listen(0, async function () {
    // request
    const form = new FormData()
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    form.append('upload', fs.createReadStream(filePath))

    await pump(form, req)
  })
})

test('should emit fileSize limitation error during streaming', function (t) {
  t.plan(5)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))
  const hashInput = crypto.createHash('sha256')

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      for await (const part of req.files({ limits: { fileSize: 16500 } })) {
        await sendToWormhole(part.file, true)
      }
      reply.code(200).send()
    } catch (error) {
      t.equal(error.message, 'Request file too large, please check multipart config')
      reply.code(500).send()
    }
  })

  fastify.listen(0, async function () {
    // request
    const knownLength = 1024 * 1024 // 1MB
    let total = knownLength
    const form = new FormData({ maxDataSize: total })
    const rs = new Readable({
      read (n) {
        if (n > total) {
          n = total
        }

        var buf = Buffer.alloc(n).fill('x')
        hashInput.update(buf)
        this.push(buf)

        total -= n

        if (total === 0) {
          t.pass('finished generating')
          hashInput.end()
          this.push(null)
        }
      }
    })
    form.append('upload', rs, {
      filename: 'random-data',
      contentType: 'binary/octect-stream',
      knownLength
    })

    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 500)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    await pump(form, req)
  })
})
