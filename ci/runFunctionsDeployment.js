#!/usr/bin/env node
'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { exportedFunctionNames } = require('./assertFirebaseFunctionsDeployed')
const { readPlan } = require('./functionsDeploymentPlan')

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
function run({ root, head, args, spawn = spawnSync }) {
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
    for (const filter of filters) {
        console.log(`Deploying ${filter}`)
        const result = spawn('firebase', ['deploy', '--only', filter, ...args], {
            cwd: root,
            stdio: 'inherit',
            env: process.env,
        })
        if (result.error) throw result.error
        if (result.status !== 0) return result.status || 1
    }
    return 0
}
if (require.main === module) {
    try {
        if (!process.env.CI_COMMIT_SHA) throw new Error('CI_COMMIT_SHA is required')
        process.exitCode = run({
            root: process.env.CI_PROJECT_DIR || path.resolve(__dirname, '..'),
            head: process.env.CI_COMMIT_SHA,
            args: process.argv.slice(2),
        })
    } catch (error) {
        console.error(`Functions deployment failed: ${error.message}`)
        process.exitCode = 1
    }
}
module.exports = { deploymentFilters, run }
