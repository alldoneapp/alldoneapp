// Jest configuration for the Cloud Functions suites (local check; CI's
// test:web:changed excludes functions/ entirely).
//
// Run with the functions runtime's Node major (which since migration Stage 5 is
// also the repo-wide major, see .nvmrc):
//
//     nvm use 22 && npx jest --config ci/jest.functions.config.js
//
// functions' own dependency tree (firebase-admin, firebase-functions, google-gax,
// ...) ships modern CommonJS that Node 22 runs natively — transforming it through
// Babel is pure waste, so /functions/node_modules/ is ignored on top of the root
// config's allowlist (which already limits transformation to the ESM/RN-era
// packages that genuinely need it; everything else, including jest's own runtime
// modules, runs untransformed).

const path = require('path')

const baseConfig = require('../package.json').jest

// Web-located suites that require functions/ code. The root config excludes them
// (so the web run doesn't need functions/node_modules installed); they run here.
const BRIDGE_SUITES = [
    '__tests__/TwilioWhatsAppService.test.js',
    '__tests__/Chats/copyChatToOtherProject.test.js',
    '__tests__/Feeds/copyInnerFeedsToOtherProject.test.js',
]

module.exports = {
    ...baseConfig,
    rootDir: path.resolve(__dirname, '..'),
    testMatch: ['<rootDir>/functions/**/*.test.js', ...BRIDGE_SUITES.map(suite => `<rootDir>/${suite}`)],
    testPathIgnorePatterns: baseConfig.testPathIgnorePatterns.filter(
        pattern => !BRIDGE_SUITES.includes(pattern) && pattern !== '<rootDir>/functions/'
    ),
    transformIgnorePatterns: [...baseConfig.transformIgnorePatterns, '/functions/node_modules/'],
    // The environment stays jsdom (inherited) because the bridge suites render web
    // code — but exports-map resolution must use the NODE conditions: with jsdom's
    // default ['browser'], jest 30 resolves e.g. jwks-rsa's `jose` to its browser
    // ESM build, which (being inside the untransformed functions/node_modules)
    // throws "Unexpected token 'export'" at require time. jest 25 predated
    // exports-map resolution entirely, so main-field (node) builds are also what
    // these suites have always run against.
    testEnvironmentOptions: {
        ...(baseConfig.testEnvironmentOptions || {}),
        customExportConditions: ['node', 'node-addons'],
    },
}
