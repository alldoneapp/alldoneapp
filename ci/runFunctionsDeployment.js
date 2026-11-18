#!/usr/bin/env node
'use strict'
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { completedFunctionNames, exportedFunctionNames } = require('./assertFirebaseFunctionsDeployed')
const { readPlan } = require('./functionsDeploymentPlan')

// Functions Firebase left without a result are redeployed by name in batches of this size. Small
// batches keep each `firebase deploy` under the Cloud Functions per-minute mutation quota, whose
// 429s are what made firebase-tools drop whole groups in the first place (2026-11-11).
const REDEPLOY_BATCH_SIZE = 20
// Matches the Cloud Functions mutation 429s firebase-tools retries itself and only logs as
// warnings, as well as the fatal ones QUOTA_ERROR_PATTERN catches.
const QUOTA_WARNING_PATTERN = /Quota exceeded/

// A Google API per-minute quota (HTTP 429) that firebase-tools does not retry itself fails the
// whole command. On 2026-11-11 the fourth 10-function batch of a production deploy died on
// `firestore.googleapis.com ... databases/(default)` ("Database Operations Per Minute") before it
// changed anything, because every batch looks the database up again for its Firestore triggers.
// The quota refills each minute and re-running a deploy is safe (functions already current are
// skipped by source hash), so wait out the minute and run the same batch again.
const QUOTA_ERROR_PATTERN = /HTTP Error: 429, Quota exceeded/
const QUOTA_RETRIES = 2
const QUOTA_RETRY_DELAY_MS = 65 * 1000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function deploymentFilters(plan) {
    if (plan.mode === 'none') throw new Error('No Functions selected; the scope gate should have skipped this job')
    if (plan.mode === 'full') return ['functions']
    return nameFilters(plan.names, 10)
}

function nameFilters(names, size) {
    const filters = []
    for (let i = 0; i < names.length; i += size)
        filters.push(
            names
                .slice(i, i + size)
                .map(name => `functions:${name}`)
                .join(',')
        )
    return filters
}

// Runs one `firebase` command, streaming its output live into the job log (and through the CI
// `tee` into functions-deploy.log) while keeping a copy to find what it did not complete.
function runFirebase(args, { cwd }) {
    return new Promise((resolve, reject) => {
        const child = spawn('firebase', args, { cwd, env: process.env, stdio: ['inherit', 'pipe', 'pipe'] })
        let output = ''
        child.stdout.on('data', chunk => {
            output += chunk
            process.stdout.write(chunk)
        })
        child.stderr.on('data', chunk => {
            output += chunk
            process.stderr.write(chunk)
        })
        child.on('error', reject)
        child.on('close', (code, signal) => resolve({ status: code === null ? 1 : code, signal, output }))
    })
}

async function run({ root, head, args, exec = runFirebase, wait = sleep }) {
    const source = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8')
    const planFile = path.join(root, 'functions-deploy-scope.json')
    const plan = readPlan(planFile, exportedFunctionNames(source), head)
    const filters = deploymentFilters(plan)
    // Persist the fallback too, so verification checks the exact same selection.
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n')
    // Runtime-only changes are not part of Firebase's source hash. This tracked-
    // commit stamp makes them deploy, without changing the function configuration.
    fs.writeFileSync(
        path.join(root, 'functions/ci-deployment.json'),
        JSON.stringify({ head, names: plan.names }) + '\n'
    )
    let output = ''
    // Resolves to { status, hitQuota }: hitQuota when Firebase met a quota 429 on the way, even one
    // it retried itself and survived.
    const deploy = async filter => {
        let hitQuota = false
        for (let attempt = 0; ; attempt++) {
            console.log(`Deploying ${filter}`)
            const result = await exec(['deploy', '--only', filter, ...args], { cwd: root })
            output += result.output || ''
            hitQuota = hitQuota || QUOTA_WARNING_PATTERN.test(result.output || '')
            if (result.status === 0 || attempt >= QUOTA_RETRIES || !QUOTA_ERROR_PATTERN.test(result.output || ''))
                return { status: result.status, hitQuota }
            console.log(
                `Firebase stopped on a Google API quota (HTTP 429); retrying this batch in ` +
                    `${QUOTA_RETRY_DELAY_MS / 1000}s (retry ${attempt + 1} of ${QUOTA_RETRIES}).`
            )
            await wait(QUOTA_RETRY_DELAY_MS)
        }
    }
    for (const filter of filters) {
        const { status } = await deploy(filter)
        if (status !== 0) return status || 1
    }

    // firebase-tools 13.29.3 deploys in parallel groups keyed by region and memory, and an
    // exception that escapes one group is only written to its debug log
    // (fabricator.applyPlan: "This should never happen"): the command still exits 0, with
    // every function of that group untouched. On 2026-11-09 a full deploy lost the 1, 2 and
    // 4 GiB groups (67 functions) on production and on staging; on 2026-11-11 a full production
    // deploy that ran into the Cloud Functions mutation quota lost 187 of 303. Redeploy exactly
    // the missing functions once, by name in small batches, waiting out the quota minute after a
    // batch that met a 429 so the next one starts with a fresh quota. Whatever is still missing
    // fails the verification step.
    const completed = completedFunctionNames(output)
    const missing = plan.names.filter(name => !completed.has(name))
    if (missing.length === 0) return 0
    console.log(
        `Firebase exited 0 but ${missing.length} Functions have no completed result; redeploying them once: ` +
            missing.join(', ')
    )
    const redeployFilters = nameFilters(missing, REDEPLOY_BATCH_SIZE)
    for (let i = 0; i < redeployFilters.length; i++) {
        const { status, hitQuota } = await deploy(redeployFilters[i])
        if (status !== 0) return status || 1
        if (hitQuota && i < redeployFilters.length - 1) {
            console.log(`That batch met a Google API quota; waiting ${QUOTA_RETRY_DELAY_MS / 1000}s before the next.`)
            await wait(QUOTA_RETRY_DELAY_MS)
        }
    }
    return 0
}

if (require.main === module) {
    ;(async () => {
        if (!process.env.CI_COMMIT_SHA) throw new Error('CI_COMMIT_SHA is required')
        process.exitCode = await run({
            root: process.env.CI_PROJECT_DIR || path.resolve(__dirname, '..'),
            head: process.env.CI_COMMIT_SHA,
            args: process.argv.slice(2),
        })
    })().catch(error => {
        console.error(`Functions deployment failed: ${error.message}`)
        process.exitCode = 1
    })
}
module.exports = { REDEPLOY_BATCH_SIZE, QUOTA_RETRIES, QUOTA_RETRY_DELAY_MS, deploymentFilters, run }
