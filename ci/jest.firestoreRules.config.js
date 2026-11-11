// Jest configuration for the Firestore rules gate (`npm run test:firestore-rules`, CI job
// test:firestore:rules). The root config ignores the emulator suite so a plain `npm test`
// without a running emulator does not fail on it; this config takes it back in. The script
// starts the emulator itself through `firebase emulators:exec`.

const path = require('path')

const baseConfig = require('../package.json').jest

const EMULATOR_SUITE = '<rootDir>/__tests__/Firestore/firestoreRules.emulator.test.js'

module.exports = {
    ...baseConfig,
    rootDir: path.resolve(__dirname, '..'),
    testPathIgnorePatterns: baseConfig.testPathIgnorePatterns.filter(pattern => pattern !== EMULATOR_SUITE),
}
