const { execFileSync } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

const baseRef = process.argv[2]
const headRef = process.argv[3] || 'HEAD'

if (!baseRef) {
    process.stderr.write('Usage: node ci/selectTargetedJestFiles.js <base-ref>\n')
    process.exit(2)
}

const excludedRoots = [
    'ci/',
    'cloudflare/',
    'firebase_tool/',
    'firestore-backups/',
    'functions/',
    'migration/',
    // Shared manual mocks are test scaffolding, not application sources. Jest
    // relates them to every suite that touches the module they stand in for, so
    // handing one to --findRelatedTests selects a large arbitrary slice of the
    // suite and defeats the point of a targeted run. The suites that matter for
    // a mock change are reached through the sources and tests changed with it.
    '__mocks__/',
]
const testPattern = /(?:^|\/)__tests__\/|[.](?:test|spec)[.][jt]sx?$/
const codePattern = /[.][jt]sx?$/

const changedFiles = execFileSync('git', ['diff', '--name-only', '-z', `${baseRef}...${headRef}`, '--'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
})
    .split('\0')
    .filter(Boolean)
    .filter(file => existsSync(file))
    .filter(file => codePattern.test(file))
    .filter(file => !excludedRoots.some(root => file.startsWith(root)))

const changedTests = changedFiles.filter(file => testPattern.test(file))
const changedTestStems = new Set(
    changedTests
        .filter(file => !file.includes('/__tests__/') && !file.startsWith('__tests__/'))
        .map(file => file.replace(/[.](?:test|spec)[.][jt]sx?$/, ''))
)
const uncoveredSources = changedFiles.filter(file => {
    if (testPattern.test(file)) return false
    return !changedTestStems.has(file.replace(/[.][jt]sx?$/, ''))
})

for (const file of [...changedTests, ...uncoveredSources]) {
    process.stdout.write(`${path.normalize(file)}\0`)
}
