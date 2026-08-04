// jest 25's resolver predates the `node:` require protocol, and its
// moduleNameMapper treats a mapped bare builtin name as a file path. This shim
// bridges `require('node:crypto')` (firebase-admin 14) to the real builtin.
// Add a sibling shim + mapper entry in ci/jest.functions.config.js if a
// dependency starts requiring another `node:`-prefixed builtin.
module.exports = require('crypto')
