# fastify-multipart

[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](http://standardjs.com/)
![Continuous
Integration](https://github.com/fastify/fastify-multipart/workflows/Continuous%20Integration/badge.svg)

Fastify plugin to parse the multipart content-type. Supports:

- Async / Await
- Async iterator support to handle multiple parts
- Stream & Disk mode
- Accumulate whole file in memory
- Mode to attach all fields to the request body
- Tested across Linux/Mac/Windows

Under the hood it uses [busboy](https://github.com/mscdex/busboy).

## Install
```
npm i fastify-multipart
```

## Usage

If you are looking for the documentation for the legacy callback-api please see [here](./callback.md).

```js
const fastify = require('fastify')()
const fs = require('fs')
const util = require('util')
const path = require('path')
const { pipeline } = require('stream')
const pump = util.promisify(pipeline)

fastify.register(require('fastify-multipart'))

fastify.post('/', async function (req, reply) {
  // process a single file
  // also, consider that if you allow to upload multiple files
  // you must consume all files othwise the promise will never fulfill
  const data = await req.file()

  data.file // stream
  data.fields // other parsed parts
  data.fieldname
  data.filename
  data.encoding
  data.mimetype

  // to accumulate the file in memory! Be careful!
  //
  // await data.toBuffer() // Buffer
  //
  // or

  await pump(data.file, fs.createWriteStream(data.filename))

  // be careful of permission issues on disk and not overwrite
  // sensitive files that could cause security risks
  
  // also, consider that if the file stream is not consumed, the promise will never fulfill

  reply.send()
})

fastify.listen(3000, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
```

You can also pass optional arguments to busboy when registering with fastify. This is useful for setting limits on the content that can be uploaded. A full list of available options can be found in the [busboy documentation](https://github.com/mscdex/busboy#busboy-methods).

**Note**: if the file stream that is provided by `data.file` is not consumed (like in the example above with the usage of pump) the promise won't be fulfilled at the end of the multipart processing.
This behavior is inherited from [busboy](https://github.com/mscdex/busboy).

```js
fastify.register(require('fastify-multipart'), {
  limits: {
    fieldNameSize: 100, // Max field name size in bytes
    fieldSize: 1000000, // Max field value size in bytes
    fields: 10,         // Max number of non-file fields
    fileSize: 100,      // For multipart forms, the max file size
    files: 1,           // Max number of file fields
    headerPairs: 2000   // Max number of header key=>value pairs
  }
});
```

If you do set upload limits, be sure to catch the error. An error or exception will occur if a limit is reached. These events are documented in more detail [here](https://github.com/mscdex/busboy#busboy-special-events).

**Note**: if the file stream that is provided by `data.file` is not consumed (like in the example below with the usage of pump) the promise won't be fulfilled at the end of the multipart processing.
This behavior is inherited from [busboy](https://github.com/mscdex/busboy).

```js
try {
  const data = await req.file()
  await pump(data.file, fs.createWriteStream(data.filename))
} catch (error) {
  if (error instanceof fastify.multipartErrors.FilesLimitError) {
    // handle error
  }
}
``` 

Additionally, you can pass per-request options to the  `req.file`, `req.files`, `req.saveRequestFiles` or `req.multipartIterator` function.

```js
fastify.post('/', async function (req, reply) {
  const options = { limits: { fileSize: 1000 } };
  const data = await req.file(options)
  await pump(data.file, fs.createWriteStream(data.filename))
  reply.send()
})
```

## Handle multiple file streams

```js
fastify.post('/', async function (req, reply) {
  const parts = await req.files()
  for await (const part of parts) {
    await pump(part.file, fs.createWriteStream(part.filename))
  }
  reply.send()
})
```

## Handle multiple file streams and fields

```js
fastify.post('/upload/raw/any', async function (req, reply) {
  const parts = await req.parts()
  for await (const part of parts) {
    if (part.file) {
      await pump(part.file, fs.createWriteStream(part.filename))
    } else {
      console.log(part)
    }
  }
  reply.send()
})
```

## Accumulate whole file in memory

```js
fastify.post('/upload/raw/any', async function (req, reply) {
  const data = await req.file()
  const buffer = await data.toBuffer()
  // upload to S3
  reply.send()
})
```


## Upload files to disk and work with temporary file paths

This will store all files in the operating system default directory for temporary files. As soon as the response ends all files are removed.

```js
fastify.post('/upload/files', async function (req, reply) {
  // stores files to tmp dir and return files
  const files = await req.saveRequestFiles()
  files[0].filepath
  files[0].fieldname
  files[0].filename
  files[0].encoding
  files[0].mimetype
  files[0].fields // other parsed parts

  reply.send()
})
```

## Parse all fields and assign them to the body

This allows you to parse all fields automatically and assign them to the `request.body`. By default files are accumulated in memory (Be careful!) to buffer objects. Uncaught errors are [handled](https://github.com/fastify/fastify/blob/master/docs/Hooks.md#manage-errors-from-a-hook) by fastify.

```js
fastify.register(require('fastify-multipart'), { attachFieldsToBody: true })

fastify.post('/upload/files', async function (req, reply) {
  const uploadValue = await req.body.upload.toBuffer()  // access files
  const fooValue = await req.body.foo.value           // other fields
})
```

You can also define a `onFile` handler to avoid accumulate all files in memory.

```js
async function onFile(part) {
  await pump(part.file, fs.createWriteStream(part.filename))
}

fastify.register(require('fastify-multipart'), { attachFieldsToBody: true, onFile })

fastify.post('/upload/files', async function (req, reply) {
  const fooValue = await req.body.foo.value           // other fields
})
```

## JSON Schema body validation

If you enable `attachFieldsToBody` and set `sharedSchemaId` a shared JSON Schema is added which can be used to validate parsed multipart fields.

```js
const opts = {
  attachFieldsToBody: true,
  sharedSchemaId: '#mySharedSchema'
}
fastify.register(require('fastify-multipart'), opts)

fastify.post('/upload/files', {
  schema: {
    body: {
      type: 'object',
      required: ['myField'],
      properties: {
        myField: { $ref: '#mySharedSchema'},
        // or
        myFiles: { type: 'array', items: fastify.getSchema('mySharedSchema') },
        // or
        hello: {
          properties: {
            value: { 
              type: 'string',
              enum: ['male']
            }
          }
        }
      }
    }
  }
}, function (req, reply) {
  console.log({ body: req.body })
  reply.send('done')
})
```

## Access all errors

We export all custom errors via a server decorator `fastify.multipartErrors`. This is useful if you want to react to specific errors. They are derivated from [fastify-error](https://github.com/fastify/fastify-error) and include the correct `statusCode` property.

```js
fastify.post('/upload/files', async function (req, reply) {
  const { FilesLimitError } = fastify.multipartErrors
})
```

## Acknowledgements

This project is kindly sponsored by:
- [nearForm](http://nearform.com)
- [LetzDoIt](http://www.letzdoitapp.com/)

## License

Licensed under [MIT](./LICENSE).
