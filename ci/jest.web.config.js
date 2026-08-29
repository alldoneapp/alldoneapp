// Jest configuration for the web-only CI check (test:web:changed).
//
// That job runs in build_base, which carries the root node_modules and nothing
// else. Cloud Functions keep a separate dependency tree - firebase-admin,
// firebase-functions, handlebars - that only ci/Dockerfile_functions installs,
// and several functions suites read the deployment variables GitLab injects
// into every job. Those suites cannot pass there no matter what a branch
// changes, which is exactly why the job never meant to run them.
//
// Keeping functions sources out of ci/selectTargetedJestFiles.js is not enough:
// --findRelatedTests walks the *inverse* dependency graph, and
// functions/shared/{NoteService,TaskService}.js reach back into
// utils/backends/** through dynamic `await import(...)` calls. Jest counts
// those statically, so touching any file the Firestore layer imports selects
// around forty functions suites. Ignore them by path instead, and leave the
// repository default alone so a local `npm test` still runs them against the
// dependencies installed in functions/.

const path = require('path')

const baseConfig = require('../package.json').jest

module.exports = {
    ...baseConfig,
    rootDir: path.resolve(__dirname, '..'),
    testPathIgnorePatterns: [
        ...baseConfig.testPathIgnorePatterns,
        '<rootDir>/functions/',
        // This suite owns its emulator lifecycle and runs in the dedicated
        // test:firestore:rules job. The regular web image does not start one.
        '<rootDir>/__tests__/Firestore/firestoreRules.emulator.test.js',
    ],
}
