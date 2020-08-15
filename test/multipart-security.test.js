'use strict'

const util = require('util')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const stream = require('stream')
const pump = util.promisify(stream.pipeline)

const filePath = path.join(__dirname, '../README.md')

test('should not allow __proto__ as file name', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      // eslint-disable-next-line
      for await (const _ of req.files()) {
        t.fail('should not be called')
      }
      reply.code(200).send()
    } catch (error) {
      t.equal(error.message, 'prototype property is not allowed as field name')
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
    const rs = fs.createReadStream(filePath)
    form.append('__proto__', rs)

    await pump(form, req)
  })
})

test('should not allow __proto__ as field name', function (t) {
  t.plan(4)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart)

  fastify.post('/', async function (req, reply) {
    t.ok(req.isMultipart())

    try {
      // eslint-disable-next-line
      for await (const _ of req.multipart()) {
        t.fail('should not be called')
      }
      reply.code(200).send()
    } catch (error) {
      t.equal(error.message, 'prototype property is not allowed as field name')
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
    form.append('__proto__', 'world')

    await pump(form, req)
  })
})
