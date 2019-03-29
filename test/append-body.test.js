'use strict'
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const pump = require('pump')

const filePath = path.join(__dirname, '../README.md')

test('append to body option', t => {
  t.plan(8)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart, { addToBody: true })

  fastify.post('/', function (req, reply) {
    t.equal(req.body.myField, 'hello')
    t.equal(req.body.myCheck, 'true')
    t.like(req.body.myFile, {
      encoding: '7bit',
      filename: 'README.md',
      limit: false,
      mimetype: 'text/markdown'
    })
    t.type(req.body.myFile.data, Buffer)
    t.equal(req.body.myFile.data.toString('utf8').substr(0, 19), '# fastify-multipart')

    reply.send('ok')
  })

  fastify.listen(0, function () {
    // request
    var form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    var rs = fs.createReadStream(filePath)
    form.append('myField', 'hello')
    form.append('myCheck', 'true')
    form.append('myFile', rs)
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('append to body option and custom stream management', t => {
  t.plan(7)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  let fileCounter = 0
  const opts = {
    addToBody: true,
    manageUploadStream: (fieldName, stream, filename, encoding, mimetype) => {
      fileCounter++
      stream.resume()
    }
  }
  fastify.register(multipart, opts)

  fastify.post('/', function (req, reply) {
    t.like(req.body.myFile, {
      data: [],
      encoding: '7bit',
      filename: 'README.md',
      limit: false,
      mimetype: 'text/markdown'
    })

    t.like(req.body.myFileTwo, {
      data: [],
      encoding: '7bit',
      filename: 'README.md',
      limit: false,
      mimetype: 'text/markdown'
    })

    t.like(req.body.myFileThree, {
      data: [],
      encoding: '7bit',
      filename: 'README.md',
      limit: false,
      mimetype: 'text/markdown'
    })

    t.equal(fileCounter, 3, 'We must receive 3 file events')
    reply.send('ok')
  })

  fastify.listen(0, function () {
    // request
    var form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    var rs1 = fs.createReadStream(filePath)
    var rs2 = fs.createReadStream(filePath)
    var rs3 = fs.createReadStream(filePath)
    form.append('myFile', rs1)
    form.append('myFileTwo', rs2)
    form.append('myFileThree', rs3)
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('append to body option and multiple files', t => {
  t.plan(7)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  const opts = {
    addToBody: true,
    manageUploadStream: (fieldName, stream, filename, encoding, mimetype) => {
      t.equal(fieldName, 'myFile')
      stream.resume()
    }
  }
  fastify.register(multipart, opts)

  fastify.post('/', function (req, reply) {
    t.equal(req.body.myField, 'hello')
    t.equal(req.body.myCheck, 'true')
    t.like(req.body.myFile, {
      data: [],
      encoding: '7bit',
      filename: 'README.md',
      limit: false,
      mimetype: 'text/markdown'
    })

    reply.send('ok')
  })

  fastify.listen(0, function () {
    // request
    var form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    var rs = fs.createReadStream(filePath)
    form.append('myField', 'hello')
    form.append('myCheck', 'true')
    form.append('myFile', rs)
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('append to body with shared schema', t => {
  t.plan(9)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  const opts = {
    addToBody: true,
    sharedSchemaId: 'mySharedSchema',
    manageUploadStream: (fieldName, stream, filename, encoding, mimetype) => {
      t.equal(fieldName, 'myFile')
      t.equal(filename, 'README.md')
      t.equal(encoding, '7bit')
      t.equal(mimetype, 'text/markdown')
      stream.resume()
    }
  }
  fastify.register(multipart, opts)

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['myField', 'myFile'],
        properties: {
          myField: { type: 'string' },
          myFile: 'mySharedSchema#'
        }
      }
    }
  }, function (req, reply) {
    t.equal(req.body.myField, 'hello')
    t.like(req.body.myFile, {
      data: [],
      encoding: '7bit',
      filename: 'README.md',
      limit: false,
      mimetype: 'text/markdown'
    })

    reply.send('ok')
  })

  fastify.listen(0, function () {
    // request
    var form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    var rs = fs.createReadStream(filePath)
    form.append('myField', 'hello')
    form.append('myFile', rs)
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('append to body with shared schema error', t => {
  t.plan(3)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  const opts = {
    addToBody: true,
    sharedSchemaId: 'mySharedSchema'
  }
  fastify.register(multipart, opts)

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['myField', 'myFile'],
        properties: {
          myField: { type: 'string' },
          myFile: 'mySharedSchema#'
        }
      }
    }
  }, function (req, reply) {
    reply.send('ok')
  })

  fastify.listen(0, function () {
    // request
    var form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 400)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    var rs = fs.createReadStream(filePath)
    // missing the myField parameter
    form.append('myFile', rs)
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})

test('append to body without files and shared schema', t => {
  t.plan(5)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  const opts = {
    addToBody: true,
    sharedSchemaId: 'mySharedSchema',
    manageUploadStream: (fieldName, stream, filename, encoding, mimetype) => {
      t.fail('there are not stream')
    }
  }
  fastify.register(multipart, opts)

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['myField', 'myField2'],
        properties: {
          myField: { type: 'string' },
          myField2: { type: 'string' }
        }
      }
    }
  }, function (req, reply) {
    t.equal(req.body.myField, 'hello')
    t.equal(req.body.myField2, 'world')

    reply.send('ok')
  })

  fastify.listen(0, function () {
    // request
    var form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })

    form.append('myField', 'hello')
    form.append('myField2', 'world')
    pump(form, req, function (err) {
      t.error(err, 'client pump: no err')
    })
  })
})
