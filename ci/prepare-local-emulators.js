#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const PINNED_CLI_VERSION = '13.29.3'
const CONFIG_HELPER_START = `async function initializeFunctionsConfigHelper() {
    const functionsResolution = await assertResolveDeveloperNodeModule("firebase-functions");
`
const SDK_V7_GUARD = `    // Alldone local compatibility: SDK 7 removed functions.config().
    if (Number(functionsResolution.version.split(".")[0]) >= 7) {
        return;
    }
`

// Backport only the emulator's legacy-config guard. Keep the pinned deployment CLI
// and the Functions SDK intact; application calls to the removed API still fail.
function patchEmulatorRuntime(source, cliVersion) {
    if (cliVersion !== PINNED_CLI_VERSION)
        throw new Error(`Review the local emulator compatibility patch for firebase-tools ${cliVersion}.`)
    if (source.includes(CONFIG_HELPER_START + SDK_V7_GUARD)) return source
    if (source.split(CONFIG_HELPER_START).length !== 2)
        throw new Error('The pinned Firebase emulator runtime changed; cannot apply its SDK 7 compatibility patch.')
    return source.replace(CONFIG_HELPER_START, CONFIG_HELPER_START + SDK_V7_GUARD)
}

function prepareLocalEmulators() {
    const cliPackage = require.resolve('firebase-tools/package.json')
    const runtimePath = path.join(path.dirname(cliPackage), 'lib/emulator/functionsEmulatorRuntime.js')
    const original = fs.readFileSync(runtimePath, 'utf8')
    const patched = patchEmulatorRuntime(original, require(cliPackage).version)
    if (patched !== original) fs.writeFileSync(runtimePath, patched)
    fs.mkdirSync(path.join(__dirname, '../.firebase/local-data'), { recursive: true })
    console.log('[emulators] Firebase CLI 13.29.3 ready for Functions SDK 7')
}

if (require.main === module) prepareLocalEmulators()

module.exports = { patchEmulatorRuntime, CONFIG_HELPER_START, SDK_V7_GUARD }
