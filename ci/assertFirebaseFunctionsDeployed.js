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

function assertCompletedDeployment(source, log) {
    // firebase-tools 13.29.3 can exit zero with work still missing after quota
    // retries. An existing function is not evidence that this deploy updated it.
    // Require a terminal result for every export, including hash-verified no-ops.
    const plainLog = log.replace(/\x1b\[[0-9;]*m/g, '')
    const completed = new Set(
        [
            ...plainLog.matchAll(
                /functions\[([\w$-]+)\([^)]+\)\]\s+(?:Successful (?:create|update) operation\.|Skipped \(No changes detected\))/g
            ),
        ].map(match => match[1])
    )
    const missing = exportedFunctionNames(source).filter(name => !completed.has(name))
    if (missing.length) {
        throw new Error(`No completed deployment result for: ${missing.join(', ')}`)
    }
    if (!plainLog.includes('Deploy complete!')) {
        throw new Error('Firebase exited without confirming that the deploy completed')
    }
}

async function readStdin() {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    return input
}

async function main() {
    const sourcePath = process.argv[2]
    const logPath = process.argv[3]
    if (!sourcePath || !logPath)
        throw new Error('Usage: assertFirebaseFunctionsDeployed.js <functions/index.js> <deploy.log>')

    const source = fs.readFileSync(sourcePath, 'utf8')
    assertCompletedDeployment(source, fs.readFileSync(logPath, 'utf8'))
    const functionsList = JSON.parse(await readStdin())
    const missing = findMissingFunctions(source, functionsList)
    if (missing.length > 0) {
        throw new Error(`Firebase reported a successful deploy but these functions are missing: ${missing.join(', ')}`)
    }

    process.stdout.write(
        `Verified completed deployment and presence of ${exportedFunctionNames(source).length} Firebase Functions.\n`
    )
}

if (require.main === module) {
    main().catch(error => {
        console.error(`functions deploy verification failed: ${error.message}`)
        process.exitCode = 1
    })
}

module.exports = { assertCompletedDeployment, deployedFunctionNames, exportedFunctionNames, findMissingFunctions }
