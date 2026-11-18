#!/usr/bin/env node
'use strict'

// The test suites related to each of many files, from ONE Jest process.
//
//     echo '["components/Foo.js","utils/bar.js"]' | node ci/listRelatedJestTests.js ci/jest.web.config.js
//
// prints {"related":{"components/Foo.js":["/abs/…/Foo.test.js"],"utils/bar.js":[]}}.
//
// ci/runWebTests.js needs the answer per file: a changed file that no suite depends on makes
// it run every suite. It used to ask Jest once per file (`jest --listTests --findRelatedTests
// <file>`), and each such process starts Jest and loads the file map again, about 1.7 seconds.
// A functions deploy with 67 changed files spent 114 seconds finding its 134 suites and 49
// seconds running them (pipeline 9824, 2026-11-18). Here the file map and the dependency
// resolver are built once and asked 67 times.
//
// This uses the pieces behind that command line (`SearchSource.findRelatedTests`), which Jest
// does not document as an API. ci/runWebTests.js therefore falls back to the command line
// whenever this script fails or answers anything unexpected, so a Jest upgrade that moves
// these pieces makes discovery slow again, never wrong.
const fs = require('fs')
const path = require('path')

async function relatedTests(configFile, inputs, cwd = process.cwd()) {
    const { readConfig } = require('jest-config')
    const Runtime = require('jest-runtime').default
    const { SearchSource } = require('@jest/core')
    const { projectConfig } = await readConfig({ $0: 'jest', _: [], config: path.resolve(cwd, configFile) }, cwd)
    const context = await Runtime.createContext(projectConfig, { maxWorkers: 1, watchman: false })
    const search = new SearchSource(context)
    const related = {}
    for (const input of inputs) {
        // The command line resolves its paths against the project's cwd in the same way.
        const { tests } = await search.findRelatedTests(new Set([path.resolve(projectConfig.cwd, input)]), false)
        related[input] = tests.map(test => test.path)
    }
    return related
}

if (require.main === module) {
    ;(async () => {
        const [configFile] = process.argv.slice(2)
        if (!configFile) throw new Error('Usage: listRelatedJestTests.js <jest config> < inputs.json')
        const inputs = JSON.parse(fs.readFileSync(0, 'utf8'))
        if (!Array.isArray(inputs) || inputs.some(input => typeof input !== 'string'))
            throw new Error('Expected a JSON array of file paths on stdin')
        const related = await relatedTests(configFile, inputs)
        process.stdout.write(JSON.stringify({ related }))
    })().catch(error => {
        console.error(`Cannot list related tests: ${error.message}`)
        process.exitCode = 1
    })
}

module.exports = { relatedTests }
