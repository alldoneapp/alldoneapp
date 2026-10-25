#!/usr/bin/env node

'use strict'

const { spawnSync } = require('child_process')

const REQUIRED_NODE_MAJOR = 22
// CVE-2026-111497 and the other October 2026 Node.js security fixes.
const MINIMUM_NODE_MINOR = 23
const MINIMUM_NODE_PATCH = 4
const MINIMUM_JAVA_MAJOR = 11

const isSupportedNodeVersion = version => {
    const [major, minor, patch] = String(version).split('.').map(Number)
    return (
        major === REQUIRED_NODE_MAJOR &&
        (minor > MINIMUM_NODE_MINOR || (minor === MINIMUM_NODE_MINOR && patch >= MINIMUM_NODE_PATCH))
    )
}

const parseJavaMajor = output => {
    const match = String(output || '').match(/version\s+"(\d+)(?:\.(\d+))?/i)
    if (!match) return null
    const first = Number(match[1])
    return first === 1 ? Number(match[2]) : first
}

const fail = messages => {
    console.error('\nRepository runtime check failed:')
    messages.forEach(message => console.error(`- ${message}`))
    console.error('\nRun `nvm install` and `nvm use` from the repository, then retry the command.')
    process.exit(1)
}

const errors = []
let selectedJavaMajor = null
if (!isSupportedNodeVersion(process.versions.node)) {
    errors.push(
        `Node ${REQUIRED_NODE_MAJOR}.${MINIMUM_NODE_MINOR}.${MINIMUM_NODE_PATCH} or newer within Node ${REQUIRED_NODE_MAJOR} ` +
            `is required; current runtime is ${process.versions.node}.`
    )
}

if (process.argv.includes('--java')) {
    const result = spawnSync('java', ['-version'], { encoding: 'utf8' })
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    const javaMajor = result.error ? null : parseJavaMajor(output)
    selectedJavaMajor = javaMajor

    if (!javaMajor || javaMajor < MINIMUM_JAVA_MAJOR) {
        errors.push(
            `Firebase emulators require Java ${MINIMUM_JAVA_MAJOR}+; ` +
                `the selected runtime is ${javaMajor ? `Java ${javaMajor}` : 'not detectable'}.`
        )
        if (process.platform === 'darwin') {
            errors.push(
                'Set JAVA_HOME to a modern JDK, for example ' +
                    '`/Applications/Android Studio.app/Contents/jbr/Contents/Home`.'
            )
        }
    }
}

if (errors.length > 0) fail(errors)

console.log(
    `[runtime] Node ${process.versions.node}` + (process.argv.includes('--java') ? `, Java ${selectedJavaMajor}` : '')
)

module.exports = { parseJavaMajor, isSupportedNodeVersion }
