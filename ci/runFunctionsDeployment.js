#!/usr/bin/env node
'use strict'
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { completedFunctionNames, exportedFunctionNames } = require('./assertFirebaseFunctionsDeployed')
const { readPlan } = require('./functionsDeploymentPlan')

// A redeploy of more than this many functions is not the partial-group loss described below,
// so it is left to the verification step instead of tying the job up for another full round.
const MAX_REDEPLOY_NAMES = 120

function deploymentFilters(plan) {
    if (plan.mode === 'none') throw new Error('No Functions selected; the scope gate should have skipped this job')
    if (plan.mode === 'full') return ['functions']
    const filters = []
    for (let i = 0; i < plan.names.length; i += 10)
        filters.push(
            plan.names
                .slice(i, i + 10)
                .map(name => `functions:${name}`)
                .join(',')
        )
    return filters
}

function filterNames(filter, plan) {
    if (filter === 'functions') return plan.names
    return filter.split(',').map(part => part.replace(/^functions:/, ''))
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

async function run({ root, head, args, exec = runFirebase }) {
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
    const deploy = async filter => {
        console.log(`Deploying ${filter}`)
        const result = await exec(['deploy', '--only', filter, ...args], { cwd: root })
        output += result.output || ''
        return result.status
    }
    for (const filter of filters) {
        const status = await deploy(filter)
        if (status !== 0) return status || 1
    }

    // firebase-tools 13.29.3 deploys in parallel groups keyed by region and memory, and an
    // exception that escapes one group is only written to its debug log
    // (fabricator.applyPlan: "This should never happen"): the command still exits 0, with
    // every function of that group untouched. On 2026-11-09 a full deploy lost the 1, 2 and
    // 4 GiB groups (67 functions) on production and on staging. Running the same command again
    // deploys exactly those, because every function that did update is now skipped by its
    // source hash. Retry once; whatever is still missing fails the verification step.
    const completed = completedFunctionNames(output)
    const missing = plan.names.filter(name => !completed.has(name))
    if (missing.length === 0) return 0
    if (missing.length > MAX_REDEPLOY_NAMES) {
        console.log(`${missing.length} Functions have no completed result; too many to redeploy automatically.`)
        return 0
    }
    console.log(
        `Firebase exited 0 but ${missing.length} Functions have no completed result; redeploying them once: ` +
            missing.join(', ')
    )
    const missingSet = new Set(missing)
    for (const filter of filters.filter(filter => filterNames(filter, plan).some(name => missingSet.has(name)))) {
        const status = await deploy(filter)
        if (status !== 0) return status || 1
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
module.exports = { MAX_REDEPLOY_NAMES, deploymentFilters, run }
