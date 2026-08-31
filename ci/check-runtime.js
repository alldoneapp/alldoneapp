#!/usr/bin/env node

'use strict'

const { spawnSync } = require('child_process')

const REQUIRED_NODE_MAJOR = 22
const MINIMUM_JAVA_MAJOR = 11

const parseJavaMajor = output => {
    const match = String(output || '').match(/version\s+"(\d+)(?:\.(\d+))?/i)
    if (!match) return null
    const first = Number(match[1])
    return first === 1 ? Number(match[2]) : first
}

const fail = messages => {
    console.error('\nRepository runtime check failed:')
    messages.forEach(message => console.error(`- ${message}`))
    console.error('\nRun `nvm use` from the repository, then retry the command.')
    process.exit(1)
}

const errors = []
const nodeMajor = Number(process.versions.node.split('.')[0])
let selectedJavaMajor = null
if (nodeMajor !== REQUIRED_NODE_MAJOR) {
    errors.push(`Node ${REQUIRED_NODE_MAJOR} is required; current runtime is ${process.version}.`)
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

module.exports = { parseJavaMajor }
