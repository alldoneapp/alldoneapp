const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { makePlan, full } = require('./selectTargetedJestFiles')
const { sourceTestAffected } = require('./sourceTestDependencies')

function resolveSuites(root, plan, listTests) {
    if (plan.mode !== 'targeted') return plan
    const all = listTests([])
    const available = new Set(all)
    if (!all.length) throw new Error('Jest discovered no web tests')
    const sourceChecks = all.filter(file => sourceTestAffected(root, file, plan.inputs))
    const related = []
    for (const input of plan.inputs) {
        const affected = listTests(['--findRelatedTests', input])
        const sourceReaders = sourceChecks.filter(file => sourceTestAffected(root, file, [input]))
        if (
            !affected.length &&
            !sourceReaders.length &&
            !/^(firebase\.json|\.firebaserc|\.gitlab-ci\.yml)$/.test(input)
        )
            return full(plan.head, `No reliable test mapping for ${input}; run every suite`, plan.base, plan.kind)
        related.push(...affected)
    }
    const suites = [...new Set([...related, ...sourceChecks])].sort()
    if (suites.some(file => !available.has(file)))
        throw new Error('Jest selected a suite outside the web configuration')
    return {
        ...plan,
        mode: suites.length ? 'targeted' : 'none',
        suites,
        totalSuites: all.length,
    }
}

function run({
    root = process.cwd(),
    planFile = 'web-test-scope.json',
    kind = 'web',
    checkScope = false,
    branchBase,
    runProcess = spawnSync,
} = {}) {
    let plan
    if (branchBase) plan = makePlan(root, branchBase, 'HEAD', { branch: true, kind })
    else {
        const head = runProcess('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
        }).stdout?.trim()
        if (!head) throw new Error('Cannot verify the checkout under test')
        try {
            plan = JSON.parse(fs.readFileSync(path.resolve(root, planFile), 'utf8'))
            if (
                plan.version !== 1 ||
                plan.head !== head ||
                !['full', 'targeted', 'none'].includes(plan.mode) ||
                !Array.isArray(plan.inputs) ||
                (plan.kind || 'web') !== kind
            )
                throw new Error('Invalid test plan')
            // A deployment gate must never quietly pass an empty selection.
            if ((plan.mode === 'none' && plan.inputs.length) || (plan.mode === 'targeted' && !plan.inputs.length))
                throw new Error('Empty deployment test selection')
        } catch (_) {
            plan = full(head, 'Missing, invalid or stale deployment test plan; run every suite', null, kind)
        }
    }
    if (checkScope) return plan.mode === 'none' ? 76 : 0
    const jest = require.resolve('jest/bin/jest')
    const args = [jest, '--config', path.join(__dirname, `jest.${kind}.config.js`), '--runInBand', '--silent']
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
        plan = full(plan.head, `${error.message}; run every suite`, plan.base, kind)
    }
    console.log(`${kind} tests: ${plan.mode}. ${plan.reason}`)
    if (plan.mode === 'targeted') console.log(`Running ${plan.suites.length} of ${plan.totalSuites} affected suites`)
    const resultFile = path.join(root, `${kind}-test-result.json`)
    fs.rmSync(resultFile, { force: true })
    if (plan.mode === 'none') {
        fs.writeFileSync(resultFile, JSON.stringify({ head: plan.head, mode: 'none' }, null, 2) + '\n')
        return 0
    }
    const result = runProcess(
        process.execPath,
        [...args, ...(plan.mode === 'targeted' ? ['--runTestsByPath', ...plan.suites] : [])],
        {
            cwd: root,
            stdio: 'inherit',
            env: {
                ...process.env,
                TZ: 'UTC',
                NODE_OPTIONS: '--max-old-space-size=4096',
            },
        }
    )
    if (result.error || result.status !== 0) return result.status || 1
    fs.writeFileSync(resultFile, JSON.stringify({ head: plan.head, mode: plan.mode }, null, 2) + '\n')
    return 0
}

if (require.main === module) {
    try {
        require('./check-runtime')
        process.exitCode = run({
            branchBase: process.argv[2] === '--branch' ? process.argv[3] : undefined,
        })
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { resolveSuites, run }
