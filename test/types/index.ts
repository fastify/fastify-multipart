import * as fastify from 'fastify'
import * as fastifyMultipart from '../..'

const app = fastify()

app.register(fastifyMultipart, {
  limits: {
    fieldNameSize: 200,
    fieldSize: 200,
    fields: 200,
    fileSize: 200,
    files: 2,
    headerPairs: 200
  }
})

app.get('/path', (request) => {
  const isMultiPart = request.isMultipart()
  request.multipart((field, file, filename, encoding, mimetype) => {
    console.log(field, file, filename, encoding, mimetype, isMultiPart)
  }, (err) => {
    throw err
  })
})
