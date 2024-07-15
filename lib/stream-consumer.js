'use strict'

module.exports = function streamToNull (stream) {
  return new Promise((resolve, reject) => {
    stream.on('data', () => {
      /* The stream needs a data reader or else it will never end. */
    })
    stream.on('close', () => {
      resolve()
    })
    stream.on('end', () => {
      resolve()
    })
    stream.on('error', (error) => {
      reject(error)
    })
  })
}
