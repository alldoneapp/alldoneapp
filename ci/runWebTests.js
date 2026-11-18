const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')
const { spawnSync } = require('child_process')
const { makePlan, full } = require('./selectTargetedJestFiles')
const { sourceTestAffected } = require('./sourceTestDependencies')

// `listRelated(inputs)` answers for all inputs from one Jest process (ci/listRelatedJestTests.js)
// as { input: [suites] }. Without it, or for an input it does not answer, Jest is asked once per
// input on the command line: the same answer, about 1.7 seconds apiece.
function resolveSuites(root, plan, listTests, listRelated) {
    if (plan.mode !== 'targeted') return plan
    const all = listTests([])
    const available = new Set(all)
    if (!all.length) throw new Error('Jest discovered no web tests')
    const sourceChecks = all.filter(file => sourceTestAffected(root, file, plan.inputs))
    let known = {}
    if (listRelated) {
        try {
            known = listRelated(plan.inputs) || {}
        } catch (error) {
            console.log(`Asking Jest once per changed file: ${error.message}`)
        }
    }
    const related = []
    for (const input of plan.inputs) {
        const affected = Array.isArray(known[input]) ? known[input] : listTests(['--findRelatedTests', input])
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

// GitLab's `parallel: N` starts N copies of a job and tells each which one it is. Null when the
// job is not split: GitLab then still sets CI_NODE_TOTAL, to 1, and no CI_NODE_INDEX.
function shardFromEnv(env) {
    if (!env.CI_NODE_TOTAL || Number(env.CI_NODE_TOTAL) === 1) return null
    const total = Number(env.CI_NODE_TOTAL)
    const index = Number(env.CI_NODE_INDEX)
    if (!Number.isInteger(total) || total < 1 || !Number.isInteger(index) || index < 1 || index > total)
        throw new Error(
            `Cannot tell which part of the suite to run: CI_NODE_INDEX=${env.CI_NODE_INDEX} of ${env.CI_NODE_TOTAL}`
        )
    return { index, total }
}

// Which copy runs a suite depends on the suite's path alone, never on its place in a list. One
// copy can end up with a longer list than the others (its dependency discovery failed, so it
// falls back to every suite); with a split by position its share would then no longer contain
// the suites the other copies leave to it. Split by path, a longer list only adds suites.
function inShard(root, file, shard) {
    const relative = path.relative(root, file).split(path.sep).join('/')
    return createHash('sha1').update(relative).digest().readUInt32BE(0) % shard.total === shard.index - 1
}

function run({
    root = process.cwd(),
    planFile = 'web-test-scope.json',
    kind = 'web',
    checkScope = false,
    branchBase,
    shard = null,
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
    const listRelated = inputs => {
        const result = runProcess(
            process.execPath,
            [path.join(__dirname, 'listRelatedJestTests.js'), path.join(__dirname, `jest.${kind}.config.js`)],
            { cwd: root, encoding: 'utf8', input: JSON.stringify(inputs), maxBuffer: 256 * 1024 * 1024 }
        )
        if (result.error || result.status !== 0) throw new Error('related tests could not be listed in one process')
        let related
        try {
            related = JSON.parse(result.stdout).related
        } catch (_) {
            throw new Error('related tests were listed in an unreadable form')
        }
        // Anything but a list of paths for an input is no answer for that input.
        const valid = value => Array.isArray(value) && value.every(file => typeof file === 'string')
        if (!related || typeof related !== 'object' || !inputs.every(input => valid(related[input])))
            throw new Error('related tests were listed incompletely')
        return related
    }
    try {
        plan = resolveSuites(root, plan, listTests, listRelated)
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
    // Null means "whatever Jest finds": the complete suite in one job.
    let suites = plan.mode === 'targeted' ? plan.suites : null
    if (shard) {
        let selected = suites
        if (!selected) {
            try {
                selected = listTests([])
            } catch (_) {
                // Without the list this copy cannot take a share. Run everything here: slow, never short.
                console.log(`Part ${shard.index} of ${shard.total}: cannot list the suites; running all of them`)
            }
        }
        if (selected) {
            // A gate must not pass because nothing was found to run.
            if (!selected.length) throw new Error(`Jest discovered no ${kind} tests`)
            suites = selected.filter(file => inShard(root, file, shard)).sort()
            console.log(`Part ${shard.index} of ${shard.total}: ${suites.length} of ${selected.length} suites`)
            if (!suites.length) {
                console.log('None of the selected suites falls to this part; the other parts run them.')
                fs.writeFileSync(resultFile, JSON.stringify({ head: plan.head, mode: plan.mode }, null, 2) + '\n')
                return 0
            }
        }
    }
    const result = runProcess(process.execPath, [...args, ...(suites ? ['--runTestsByPath', ...suites] : [])], {
        cwd: root,
        stdio: 'inherit',
        env: {
            ...process.env,
            TZ: 'UTC',
            NODE_OPTIONS: '--max-old-space-size=4096',
        },
    })
    if (result.error || result.status !== 0) return result.status || 1
    fs.writeFileSync(resultFile, JSON.stringify({ head: plan.head, mode: plan.mode }, null, 2) + '\n')
    return 0
}

if (require.main === module) {
    try {
        require('./check-runtime')
        process.exitCode = run({
            branchBase: process.argv[2] === '--branch' ? process.argv[3] : undefined,
            shard: shardFromEnv(process.env),
        })
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { resolveSuites, run, shardFromEnv, inShard }
