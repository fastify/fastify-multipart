# fastify-multipart

[![Greenkeeper badge](https://badges.greenkeeper.io/fastify/fastify-multipart.svg)](https://greenkeeper.io/)

[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](http://standardjs.com/)  [![Build Status](https://travis-ci.org/fastify/fastify-multipart.svg?branch=master)](https://travis-ci.org/fastify/fastify-multipart)

Fastify plugin to parse the multipart content-type.

Under the hood it uses [busboy](https://github.com/mscdex/busboy).

## Install
```
npm i fastify-multipart --save
```
## Usage

```js
const fastify = require('fastify')()
const concat = require('concat-stream')
const fs = require('fs')
const pump = require('pump')

fastify.register(require('fastify-multipart'))

fastify.post('/', function (req, reply) {
  const mp = req.multipart(handler, function (err) {
    console.log('upload completed')
    reply.code(200).send()
  })

  // mp is an instance of
  // https://www.npmjs.com/package/busboy

  mp.on('field', function (key, value) {
    console.log('form-data', key, value)
  })

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
  }
})

fastify.listen(3000, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
```

## Acknowledgements

This project is kindly sponsored by:
- [nearForm](http://nearform.com)
- [LetzDoIt](http://www.letzdoitapp.com/)

## License

Licensed under [MIT](./LICENSE).
