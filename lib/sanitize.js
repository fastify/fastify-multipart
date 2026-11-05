'use strict'

const path = require('node:path')

// Returns a file extension (including the leading dot) only when it is safe to
// use as a suffix of a temporary filename, otherwise returns ''.
//
// The extension comes from the client-supplied filename, so it must not be able
// to influence the temp path beyond a predictably safe suffix. Some characters
// are mishandled by file systems: on NTFS, ':' starts an alternate data stream,
// so a filename such as 'a.txt:s' turns '<id>.txt:s' into an ADS path and leaves
// an empty '<id>.txt' behind after cleanup. The characters '<', '>', ':', '"',
// '|', '?' and '*' are reserved in Windows path components, and trailing dots or
// spaces are also problematic. Keep only well-formed alphanumeric extensions and
// drop everything else.
function safeExtension (filename) {
  const ext = filename ? path.extname(filename) : ''
  return /^\.[A-Za-z0-9]{1,16}$/.test(ext) ? ext : ''
}

module.exports = { safeExtension }
