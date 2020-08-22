# fastify-multipart

[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](http://standardjs.com/)
![Continuous
Integration](https://github.com/fastify/fastify-multipart/workflows/Continuous%20Integration/badge.svg)

Fastify plugin to parse the multipart content-type. Supports:

- Async / Await
- Async iterator support to handle multiple parts
- Stream & Disk mode
- Accumulate whole file in memory

Under the hood it uses [busboy](https://github.com/mscdex/busboy).

## Install
```
npm i fastify-multipart
```

## Usage

If you are looking for the documentation for the legacy api before v3 please see [here](./README-legacy.md).

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
  // but handle only one the promise will never fulfill
  const data = await req.file()

  // to accumulate the file in memory! Be careful!
  //
  // await data.content // Buffer
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

**Note**: if the file stream that is provided to the handler function is not consumed (like in the example above with the usage of pump) the onEnd callback won't be called at the end of the multipart processing.
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

```js
try {
  const data = await req.file()
} catch (error) {
  if (error instanceof fastify.multipartErrors.FilesLimitError) {
    // handle error
  }
}
``` 

Additionally, you can pass per-request options to the req.multipart function

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
  const parts = await req.multipart()
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
  const buffer = await data.content
  // upload to S3
  reply.send()
})
```


## Upload files to disk and work with temporary file paths

This will store all files in the operating system default directory for temporary files. As soon as the response ends all files are removed.

```js
fastify.post('/upload/files', async function (req, reply) {
  // stores files to tmp dir and return paths
  const files = await req.saveRequestFiles()
  reply.send()
})
```

## Access all errors

We export all custom errors via a server decorator `fastify.multipartErrors`. This useful if you want to react to specific errors. They are derivated from [fastify-error](https://github.com/fastify/fastify-error) and already include the correct `statusCode`.

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
