# fastify-multipart

[![Greenkeeper badge](https://badges.greenkeeper.io/fastify/fastify-multipart.svg)](https://greenkeeper.io/) 
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](http://standardjs.com/)
[![Build Status](https://travis-ci.org/fastify/fastify-multipart.svg?branch=master)](https://travis-ci.org/fastify/fastify-multipart)

Fastify plugin to parse the multipart content-type.

Under the hood it uses [busboy](https://github.com/mscdex/busboy).

## Install
```
npm i fastify-multipart
```

## Usage

```js
const fastify = require('fastify')()
const concat = require('concat-stream')
const fs = require('fs')
const pump = require('pump')

fastify.register(require('fastify-multipart'))

fastify.post('/', function (req, reply) {
  // you can use this request's decorator to check if the request is multipart
  if (!req.isMultipart()) {
    reply.code(400).send(new Error('Request is not multipart'))
    return
  }

  const mp = req.multipart(handler, onEnd)
  
  // mp is an instance of
  // https://www.npmjs.com/package/busboy

  mp.on('field', function (key, value) {
    console.log('form-data', key, value)
  })

  function onEnd(err) {
    console.log('upload completed')
    reply.code(200).send()
  }

  function handler (field, file, filename, encoding, mimetype) {
    // to accumulate the file in memory! Be careful!
    //
    // file.pipe(concat(function (buf) {
    //   console.log('received', filename, 'size', buf.length)
    // }))
    //
    // or

    pump(file, fs.createWriteStream('a-destination'))

    // be careful of permission issues on disk and not overwrite
    // sensitive files that could cause security risks
    
    // also, consider that if the file stream is not consumed, the 
    // onEnd callback won't be called
  }
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

If you do set upload limits, be sure to listen for limit events in the handler method. An error or exception will not occur if a limit is reached, but rather the stream will be truncated. These events are documented in more detail [here](https://github.com/mscdex/busboy#busboy-special-events).

```js

mp.on('partsLimit', () => console.log('Maximum number of form parts reached'));

mp.on('filesLimit', () => console.log('Maximum number of files reached'));

mp.on('fieldsLimit', () => console.log('Maximim number of fields reached'));

function handler (field, file, filename, encoding, mimetype) {
  file.on('limit', () => console.log('File size limit reached'));
}              
```

Note, if the file size limit is exceeded the file will not be attached to the body. 

Additionally, you can pass per-request options to the req.multipart function

```js
fastify.post('/', function (req, reply) {
  const options = { limits: { fileSize: 1000 } };
  const mp = req.multipart(handler, done, options)

  function done (err) {
    console.log('upload completed')
    reply.code(200).send()
  }

  function handler (field, file, filename, encoding, mimetype) {
    pump(file, fs.createWriteStream('a-destination'))
  }
})
```

You can also use all the parsed HTTP request parameters to the body:

```js
const options = {
  addToBody: true,
  sharedSchemaId: 'MultipartFileType', // Optional shared schema id
  onFile: (fieldName, stream, filename, encoding, mimetype, body) => {
    // Manage the file stream like you need
    // By default the data will be added in a Buffer
    // Be careful to accumulate the file in memory!
    // It is MANDATORY consume the stream, otherwise the response will not be processed!
    // The body parameter is the object that will be added to the request
    stream.resume()
  },
  limit: { /*...*/ } // You can the limit options in any case
}

fastify.register(require('fastify-multipart'), options)

fastify.post('/', function (req, reply) {
  console.log(req.body)
  // This will print out:
  // {
  //   myStringField: 'example',
  //   anotherOne: 'example',
  //   myFilenameField: [{
  //     data: <Buffer>,
  //     encoding: '7bit',
  //     filename: 'README.md',
  //     limit: false,
  //     mimetype: 'text/markdown'
  //   }]
  // }

  reply.code(200).send()
})
```

The options `onFile` and `sharedSchemaId` will be used only when `addToBody: true`.

The `onFile` option define how the file streams are managed:
+ if you don't set it the `req.body.<fieldName>[index].data` will be a Buffer with the data loaded in memory
+ if you set it with a function you **must** consume the stream, and the `req.body.<fieldName>[index].data` will be an empty array

**Note**: By default values in fields with files have array type, so if there's only one file uploaded, you can access it via `req.body.<fieldName>[0].data`. Regular fields become an array only when multiple values are provided.

The `sharedSchemaId` parameter must provide a string ID and a [shared schema](https://github.com/fastify/fastify/blob/master/docs/Validation-and-Serialization.md#adding-a-shared-schema) will be added to your fastify instance so you will be able to apply the validation to your service like this:

```js
fastify.post('/upload', {
  schema: {
    body: {
      type: 'object',
      required: ['myStringField', 'myFilenameField'],
      properties: {
        myStringField: { type: 'string' },
        myFilenameField: { type: 'array', items: 'MultipartFileType#' }
    }
  }
}, function (req, reply) {
  reply.send('done')
})
```

The shared schema added will be like this:

```js
{
  type: 'object',
  properties: {
    encoding: { type: 'string' },
    filename: { type: 'string' },
    limit: { type: 'boolean' },
    mimetype: { type: 'string' }
  }
}
```

## Acknowledgements

This project is kindly sponsored by:
- [nearForm](http://nearform.com)
- [LetzDoIt](http://www.letzdoitapp.com/)

## License

Licensed under [MIT](./LICENSE).
