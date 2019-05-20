import * as fastify from 'fastify'
import fastifyMultipart from '../..'

/** TODO This import must be decommented when this
 *  https://github.com/standard/standard/pull/1101
 *  PR will be merged and released
*/
// import { Readable } from 'stream'

const app = fastify()

app.register(fastifyMultipart, {
  addToBody: true,
  sharedSchemaId: 'sharedId',
  // stream should be of type streams.Readable
  // body should be of type fastifyMulipart.Record<string, BodyEntry>
  onFile: (fieldName: string, stream: any, filename: string, encoding: string, mimetype: string, body: Record<string, any>) => {
    console.log(fieldName, stream, filename, encoding, mimetype, body)
  },
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
