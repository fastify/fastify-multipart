'use strict'

const test = require('node:test')
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const streamToNull = require('../lib/stream-consumer')

const filePath = path.join(__dirname, '../README.md')

test('should transformRequest called when option passed', function (t, done) {
  t.plan(3)

  let transformRequestCalled = false
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(multipart, {
    transformRequest: (request) => {
      transformRequestCalled = true
      return request
    }
  })

  fastify.post('/', async function (req, reply) {
    const parts = req.parts()

    for await (const part of parts) {
      if (part.file) {
        await streamToNull(part.file)
      }
    }

    t.assert.ok(transformRequestCalled, 'transformRequest should have been called')
    reply.code(200).send()
  })

  fastify.listen({ port: 0 }, function () {
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
      t.assert.strictEqual(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.assert.ok('res ended successfully')
        done()
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('hello', 'world')

    form.pipe(req)
  })
})
