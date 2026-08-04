// Jest configuration for the Cloud Functions suites (local check; CI's
// test:web:changed excludes functions/ entirely).
//
// Run with the functions runtime's Node major, NOT the web-pinned Node 14:
//
//     nvm use 22 && npx jest --config ci/jest.functions.config.js
//
// Reason: functions' own dependency tree (firebase-admin 14, firebase-functions 7,
// google-gax 5, ...) ships modern CommonJS - class static blocks and `node:`-prefixed
// builtin requires - that the web toolchain's pinned Babel (@babel/core 7.12, needed
// by babel-preset-expo 8 / metro preset 0.56) cannot parse, and that Node 14 cannot
// execute. Instead of transforming those packages, this config skips Babel for
// functions/node_modules and lets Node 22 run them natively; application code and
// the root node_modules keep the normal web transform. The `node:` mapper works
// around jest 25's resolver predating the node: protocol.

const path = require('path')

const baseConfig = require('../package.json').jest

module.exports = {
    ...baseConfig,
    rootDir: path.resolve(__dirname, '..'),
    testMatch: ['<rootDir>/functions/**/*.test.js'],
    transformIgnorePatterns: ['/functions/node_modules/'],
    moduleNameMapper: {
        ...baseConfig.moduleNameMapper,
        '^node:crypto$': '<rootDir>/ci/nodeShims/crypto.js',
    },
}
