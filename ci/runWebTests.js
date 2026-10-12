const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { makePlan, full } = require('./selectTargetedJestFiles')

function resolveSuites(root, plan, listTests) {
    if (plan.mode !== 'targeted') return plan
    const all = listTests([])
    const available = new Set(all)
    if (!all.length) throw new Error('Jest discovered no web tests')
    if (plan.inputs.length > 30) return full(plan.head, 'Large change set; run every web suite', plan.base)
    const related = []
    for (const input of plan.inputs) {
        const affected = listTests(['--findRelatedTests', input])
        if (!affected.length)
            return full(plan.head, `No reliable test mapping for ${input}; run every web suite`, plan.base)
        related.push(...affected)
    }
    const smoke = require('./web-test-smoke.json').map(file => path.resolve(root, file))
    if (smoke.some(file => !available.has(file)))
        throw new Error('A required web smoke suite is missing from Jest discovery')
    // Tests that read source files/directories bypass Jest's import graph. Keep
    // these wiring, lifecycle and CI guardrails in every deployment gate.
    const sourceChecks = all.filter(file => /readFileSync|readdirSync/.test(fs.readFileSync(file, 'utf8')))
    const suites = [...new Set([...related, ...smoke, ...sourceChecks])].sort()
    if (suites.some(file => !available.has(file)))
        throw new Error('Jest selected a suite outside the web configuration')
    return { ...plan, suites, totalSuites: all.length }
}

function run({ root = process.cwd(), planFile = 'web-test-scope.json', branchBase, runProcess = spawnSync } = {}) {
    let plan
    if (branchBase) plan = makePlan(root, branchBase, 'HEAD', { branch: true })
    else {
        const head = runProcess('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim()
        if (!head) throw new Error('Cannot verify the checkout under test')
        try {
            plan = JSON.parse(fs.readFileSync(path.resolve(root, planFile), 'utf8'))
            if (
                plan.version !== 1 ||
                plan.head !== head ||
                !['full', 'targeted', 'none'].includes(plan.mode) ||
                !Array.isArray(plan.inputs)
            )
                throw new Error('Invalid test plan')
            // A deployment gate must never quietly pass an empty selection.
            if (plan.mode === 'none' || (plan.mode === 'targeted' && !plan.inputs.length))
                throw new Error('Empty deployment test selection')
        } catch (_) {
            plan = full(head, 'Missing, invalid or stale deployment test plan; run every web suite')
        }
    }
    const jest = require.resolve('jest/bin/jest')
    const args = [jest, '--config', path.join(__dirname, 'jest.web.config.js'), '--runInBand', '--silent']
    const listTests = extra => {
        const result = runProcess(process.execPath, [...args, '--listTests', '--json', ...extra], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 30 * 1024 * 1024,
        })
        if (result.error || result.status !== 0) throw new Error('Jest dependency discovery failed')
        const files = JSON.parse(result.stdout)
        if (!Array.isArray(files) || files.some(file => typeof file !== 'string'))
            throw new Error('Invalid Jest test discovery')
        return files
    }
    try {
        plan = resolveSuites(root, plan, listTests)
    } catch (error) {
        plan = full(plan.head, `${error.message}; run every web suite`, plan.base)
    }
    console.log(`Web tests: ${plan.mode}. ${plan.reason}`)
    if (plan.mode === 'targeted')
        console.log(
            `Running ${plan.suites.length} of ${plan.totalSuites} suites, including smoke and source guardrails`
        )
    const resultFile = path.join(root, 'web-test-result.json')
    fs.rmSync(resultFile, { force: true })
    if (plan.mode === 'none') return 0 // Branch-only no-op; deployment plans cannot reach this.
    const result = runProcess(
        process.execPath,
        [...args, ...(plan.mode === 'targeted' ? ['--runTestsByPath', ...plan.suites] : [])],
        { cwd: root, stdio: 'inherit', env: { ...process.env, TZ: 'UTC', NODE_OPTIONS: '--max-old-space-size=4096' } }
    )
    if (result.error || result.status !== 0) return result.status || 1
    fs.writeFileSync(resultFile, JSON.stringify({ head: plan.head, mode: plan.mode }, null, 2) + '\n')
    return 0
}

if (require.main === module) {
    try {
        require('./check-runtime')
        process.exitCode = run({ branchBase: process.argv[2] === '--branch' ? process.argv[3] : undefined })
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { resolveSuites, run }
