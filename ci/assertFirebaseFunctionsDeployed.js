#!/usr/bin/env node
'use strict'

const fs = require('fs')

function exportedFunctionNames(source) {
    return [...source.matchAll(/^exports\.([A-Za-z_$][\w$]*)\s*=/gm)].map(match => match[1])
}

function deployedFunctionNames(functionsList) {
    const endpoints = Array.isArray(functionsList) ? functionsList : functionsList?.result
    if (!Array.isArray(endpoints)) throw new Error('Firebase functions:list returned an unexpected payload')

    return new Set(
        endpoints
            .map(endpoint => endpoint?.id || endpoint?.name?.split('/').pop())
            .filter(name => typeof name === 'string' && name)
    )
}

function findMissingFunctions(source, functionsList) {
    const deployed = deployedFunctionNames(functionsList)
    return exportedFunctionNames(source).filter(name => !deployed.has(name))
}

async function readStdin() {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    return input
}

async function main() {
    const sourcePath = process.argv[2]
    if (!sourcePath) throw new Error('Usage: assertFirebaseFunctionsDeployed.js <functions/index.js>')

    const source = fs.readFileSync(sourcePath, 'utf8')
    const functionsList = JSON.parse(await readStdin())
    const missing = findMissingFunctions(source, functionsList)
    if (missing.length > 0) {
        throw new Error(`Firebase reported a successful deploy but these functions are missing: ${missing.join(', ')}`)
    }

    process.stdout.write(`Verified ${exportedFunctionNames(source).length} deployed Firebase Functions.\n`)
}

if (require.main === module) {
    main().catch(error => {
        console.error(`functions deploy verification failed: ${error.message}`)
        process.exitCode = 1
    })
}

module.exports = { deployedFunctionNames, exportedFunctionNames, findMissingFunctions }
