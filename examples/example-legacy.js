'use strict'

const fastify = require('fastify')()
const fs = require('fs')
const path = require('path')
const pump = require('pump')
const form = path.join(__dirname, '..', 'form.html')

fastify.register(require('..'))

fastify.get('/', function (req, reply) {
  reply.type('text/html').send(fs.createReadStream(form))
})

fastify.post('/upload/files', function (req, reply) {
  const mp = req.multipart(handler, function (err) {
    if (err) {
      reply.send(err)
      return
    }
    console.log('upload completed', process.memoryUsage().rss)
    reply.code(200).send()
  })

  mp.on('field', function (key, value) {
    console.log('form-data', key, value)
  })

  function handler (field, file, filename, encoding, mimetype) {
    pump(file, fs.createWriteStream('a-destination'))
  }
})

fastify.listen({ port: 3000 }, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
