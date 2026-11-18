/** @jest-environment node */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { resolveSuites, run, shardFromEnv, inShard } = require('../../ci/runWebTests')
const smokePaths = require('../../ci/web-test-smoke.json')

describe('web test execution gate', () => {
    let root, smoke, own, dependent, sourceGuard
    const head = 'a'.repeat(40)
    const plan = {
        version: 1,
        mode: 'targeted',
        head,
        base: 'b'.repeat(40),
        inputs: ['components/Foo.js', 'components/Foo.test.js'],
        reason: 'Changed feature',
    }
    const write = (file, contents = "test('works', () => {})") => {
        const absolute = path.join(root, file)
        fs.mkdirSync(path.dirname(absolute), { recursive: true })
        fs.writeFileSync(absolute, contents)
        return absolute
    }
    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'web-test-runner-')))
        smoke = smokePaths.map(file => write(file))
        own = write('components/Foo.test.js')
        dependent = write('components/Bar.test.js')
        sourceGuard = write('__tests__/SourceWiring.test.js', "const fs = require('fs'); fs.readFileSync('source.js')")
    })
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
    const listTests = extra =>
        extra.length
            ? extra[1].endsWith('.test.js')
                ? [own]
                : [own, dependent]
            : [...smoke, own, dependent, sourceGuard]

    it('includes dependent components even when the changed source has a changed co-located test', () => {
        const result = resolveSuites(root, plan, listTests)
        expect(result.suites).toEqual([dependent, own].sort())
        expect(new Set(result.suites).size).toBe(result.suites.length)
    })
    it('falls back to every suite when any changed input is unmapped, even if another input has tests', () => {
        const result = resolveSuites(root, plan, extra => (extra[1] === 'components/Foo.js' ? [] : listTests(extra)))
        expect(result.mode).toBe('full')
    })
    it('does not require unrelated smoke suites', () => {
        expect(resolveSuites(root, plan, () => [own]).suites).toEqual([own])
    })
    it('keeps a large but mapped change targeted', () => {
        expect(resolveSuites(root, { ...plan, inputs: Array(31).fill('components/Foo.js') }, listTests).mode).toBe(
            'targeted'
        )
    })

    function processRunner({ status = 0, discoveryFails = false } = {}) {
        return jest.fn((command, args) => {
            if (command === 'git') return { status: 0, stdout: head }
            if (args.includes('--listTests')) {
                if (discoveryFails) return { status: 1 }
                const index = args.indexOf('--findRelatedTests')
                return {
                    status: 0,
                    stdout: JSON.stringify(listTests(index >= 0 ? args.slice(index) : [])),
                }
            }
            return { status }
        })
    }
    const writePlan = value => write('web-test-scope.json', JSON.stringify(value))

    it('executes selected suites and publishes evidence only after they pass', () => {
        writePlan(plan)
        const runProcess = processRunner()
        expect(run({ root, runProcess })).toBe(0)
        const args = runProcess.mock.calls.at(-1)[1]
        expect(args).toContain('--runTestsByPath')
        expect(args).toEqual(expect.arrayContaining([own, dependent]))
        expect(JSON.parse(fs.readFileSync(path.join(root, 'web-test-result.json'), 'utf8'))).toEqual({
            head,
            mode: 'targeted',
        })
    })
    it('blocks deployment on a failing test and never records successful validation', () => {
        writePlan(plan)
        write('web-test-result.json', JSON.stringify({ head, mode: 'full' }))
        expect(run({ root, runProcess: processRunner({ status: 1 }) })).toBe(1)
        expect(fs.existsSync(path.join(root, 'web-test-result.json'))).toBe(false)
    })
    it.each([null, { ...plan, head: 'stale' }, { ...plan, inputs: [] }, { ...plan, version: 99 }])(
        'runs the full suite for missing, stale or invalid plans: %j',
        value => {
            if (value) writePlan(value)
            const runProcess = processRunner()
            expect(run({ root, runProcess })).toBe(0)
            expect(runProcess.mock.calls.at(-1)[1]).not.toContain('--runTestsByPath')
            expect(JSON.parse(fs.readFileSync(path.join(root, 'web-test-result.json'), 'utf8')).mode).toBe('full')
        }
    )
    it('accepts a verified no-op plan without executing tests', () => {
        writePlan({ ...plan, mode: 'none', inputs: [] })
        const runProcess = processRunner()
        expect(run({ root, runProcess })).toBe(0)
        expect(runProcess.mock.calls.filter(([command]) => command === process.execPath)).toHaveLength(0)
        expect(JSON.parse(fs.readFileSync(path.join(root, 'web-test-result.json'))).mode).toBe('none')
    })
    it('checks backend no-op scope before dependency installation', () => {
        write('functions-test-scope.json', JSON.stringify({ ...plan, kind: 'functions', mode: 'none', inputs: [] }))
        const runProcess = processRunner()
        expect(
            run({
                root,
                kind: 'functions',
                planFile: 'functions-test-scope.json',
                checkScope: true,
                runProcess,
            })
        ).toBe(76)
        expect(runProcess.mock.calls).toHaveLength(1)
    })
    it('retains a source-reading test only for its changed source', () => {
        write(
            '__tests__/SourceWiring.test.js',
            "const fs = require('fs'); const path = require('path'); const source = path.resolve(__dirname, '../components/Foo.js'); fs.readFileSync(source)"
        )
        expect(resolveSuites(root, plan, listTests).suites).toContain(sourceGuard)
        write('__tests__/SourceWiring.test.js', "const fs = require('fs'); fs.readFileSync('components/Unrelated.js')")
        expect(resolveSuites(root, plan, listTests).suites).not.toContain(sourceGuard)
    })
    it('runs only the source reader for a CI shell change, and retains full validation if unmapped', () => {
        const next = { ...plan, inputs: ['ci/deployScope.sh'] }
        write('__tests__/SourceWiring.test.js', "const fs = require('fs'); fs.readFileSync('ci/deployScope.sh')")
        const discover = extra => (extra.length ? [] : listTests([]))
        expect(resolveSuites(root, next, discover).suites).toEqual([sourceGuard])
        write('__tests__/SourceWiring.test.js', "const fs = require('fs'); fs.readFileSync('ci/other.sh')")
        expect(resolveSuites(root, next, discover).mode).toBe('full')
    })
    it('allows a mapped infrastructure-only change to skip unrelated web tests', () => {
        const next = { ...plan, inputs: ['firebase.json'] }
        expect(resolveSuites(root, next, extra => (extra.length ? [] : listTests([]))).mode).toBe('none')
    })
    it('executes the full suite if Jest dependency discovery fails', () => {
        writePlan(plan)
        const runProcess = processRunner({ discoveryFails: true })
        expect(run({ root, runProcess })).toBe(0)
        expect(runProcess.mock.calls.at(-1)[1]).not.toContain('--runTestsByPath')
    })

    // One Jest process per changed file took 114 seconds to find the suites of a 67-file
    // functions deploy that then ran in 49 (pipeline 9824). ci/listRelatedJestTests.js answers
    // for all files at once; the command line stays as the fallback.
    describe('related suites from one Jest process', () => {
        const RELATED_SCRIPT = path.join(__dirname, '..', '..', 'ci', 'listRelatedJestTests.js')
        const quiet = fn => {
            const log = jest.spyOn(console, 'log').mockImplementation(() => {})
            try {
                return fn()
            } finally {
                log.mockRestore()
            }
        }
        const perInput = jest.fn(extra => listTests(extra))
        beforeEach(() => perInput.mockClear())
        const asked = () => perInput.mock.calls.filter(([extra]) => extra.length).map(([extra]) => extra[1])

        it('takes the answer for every input and asks the command line for none', () => {
            const listRelated = jest.fn(() => ({
                'components/Foo.js': [own, dependent],
                'components/Foo.test.js': [own],
            }))
            const result = resolveSuites(root, plan, perInput, listRelated)
            expect(listRelated).toHaveBeenCalledWith(plan.inputs)
            expect(result.suites).toEqual([dependent, own].sort())
            expect(asked()).toEqual([])
        })
        it('asks the command line for an input the one process did not answer', () => {
            const result = resolveSuites(root, plan, perInput, () => ({ 'components/Foo.test.js': [own] }))
            expect(asked()).toEqual(['components/Foo.js'])
            expect(result.suites).toEqual([dependent, own].sort())
        })
        it('asks the command line for everything when the one process fails', () => {
            const failing = () => {
                throw new Error('moved in a Jest upgrade')
            }
            const result = quiet(() => resolveSuites(root, plan, perInput, failing))
            expect(asked()).toEqual(plan.inputs)
            expect(result.suites).toEqual([dependent, own].sort())
        })
        it('still runs every suite when an input has no related suite either way', () => {
            const result = resolveSuites(root, plan, perInput, () => ({
                'components/Foo.js': [],
                'components/Foo.test.js': [own],
            }))
            expect(result.mode).toBe('full')
            expect(asked()).toEqual([])
        })

        const withRelated = answer =>
            jest.fn((command, args, options) => {
                if (command === 'git') return { status: 0, stdout: head }
                if (args[0] === RELATED_SCRIPT) return answer(JSON.parse(options.input), args)
                if (args.includes('--listTests')) {
                    const index = args.indexOf('--findRelatedTests')
                    return { status: 0, stdout: JSON.stringify(listTests(index >= 0 ? args.slice(index) : [])) }
                }
                return { status: 0 }
            })
        const perInputCalls = runProcess =>
            runProcess.mock.calls.filter(([, args]) => args.includes('--findRelatedTests')).length

        it('hands all inputs to one process and runs what it names', () => {
            writePlan(plan)
            const runProcess = withRelated((inputs, args) => {
                expect(inputs).toEqual(plan.inputs)
                expect(args[1]).toMatch(/jest\.web\.config\.js$/)
                return {
                    status: 0,
                    stdout: JSON.stringify({
                        related: { 'components/Foo.js': [dependent], 'components/Foo.test.js': [own] },
                    }),
                }
            })
            expect(quiet(() => run({ root, runProcess }))).toBe(0)
            expect(perInputCalls(runProcess)).toBe(0)
            const args = runProcess.mock.calls.at(-1)[1]
            expect(args.slice(args.indexOf('--runTestsByPath') + 1).sort()).toEqual([dependent, own].sort())
        })
        it.each([
            ['a failing process', () => ({ status: 1, stdout: '' })],
            ['output that is not JSON', () => ({ status: 0, stdout: 'Determining test suites to run...' })],
            [
                'an answer missing an input',
                () => ({ status: 0, stdout: JSON.stringify({ related: { 'components/Foo.js': [] } }) }),
            ],
            [
                'an answer that is not a list of paths',
                inputs => ({
                    status: 0,
                    stdout: JSON.stringify({ related: Object.fromEntries(inputs.map(input => [input, 'all'])) }),
                }),
            ],
        ])('falls back to the command line on %s', (_, answer) => {
            writePlan(plan)
            const runProcess = withRelated(answer)
            expect(quiet(() => run({ root, runProcess }))).toBe(0)
            expect(perInputCalls(runProcess)).toBe(plan.inputs.length)
            const args = runProcess.mock.calls.at(-1)[1]
            expect(args.slice(args.indexOf('--runTestsByPath') + 1).sort()).toEqual([dependent, own].sort())
        })

        it('answers what the command line answers, on a real dependency graph', () => {
            write('components/payload.json', '{"value":1}')
            write('components/Foo.js', "module.exports = require('./payload.json').value")
            write('components/Bar.js', "module.exports = require('./Foo')")
            write('components/Lonely.js', 'module.exports = 1')
            write('components/Foo.test.js', "require('./Foo'); test('foo', () => {})")
            write('components/Bar.test.js', "require('./Bar'); test('bar', () => {})")
            fs.unlinkSync(sourceGuard)
            const config = write('jest.config.js', "module.exports = { rootDir: __dirname, testEnvironment: 'node' }")
            const inputs = ['components/payload.json', 'components/Foo.js', 'components/Bar.js', 'components/Lonely.js']
            const one = JSON.parse(
                execFileSync(process.execPath, [RELATED_SCRIPT, config], {
                    cwd: root,
                    encoding: 'utf8',
                    input: JSON.stringify(inputs),
                })
            ).related
            for (const input of inputs) {
                const commandLine = JSON.parse(
                    execFileSync(
                        process.execPath,
                        [
                            require.resolve('jest/bin/jest'),
                            '--config',
                            config,
                            '--listTests',
                            '--json',
                            '--findRelatedTests',
                            input,
                        ],
                        { cwd: root, encoding: 'utf8' }
                    )
                )
                expect([...one[input]].sort()).toEqual(commandLine.sort())
            }
            expect(one['components/payload.json'].sort()).toEqual([dependent, own].sort())
            expect(one['components/Lonely.js']).toEqual([])
        }, 60000)
    })

    // `parallel: N` in .gitlab-ci.yml starts N copies of the job. Run in one process on a
    // 2-vCPU runner the suite took nine minutes while the web build was done after three and a half.
    describe('split over parallel copies of the job', () => {
        const TOTAL = 4
        const quiet = fn => {
            const log = jest.spyOn(console, 'log').mockImplementation(() => {})
            try {
                return fn()
            } finally {
                log.mockRestore()
            }
        }
        const suitesRun = runProcess => {
            const args = runProcess.mock.calls.at(-1)[1]
            const index = args.indexOf('--runTestsByPath')
            return index < 0 || args.includes('--listTests') ? null : args.slice(index + 1)
        }
        // Every copy's share, in order; null for a copy that ran no Jest suite process.
        const shares = runnerFor =>
            Array.from({ length: TOTAL }, (_, i) => {
                const runProcess = runnerFor(i + 1)
                expect(quiet(() => run({ root, runProcess, shard: { index: i + 1, total: TOTAL } }))).toBe(0)
                return suitesRun(runProcess)
            })
        const everySuite = () => [...smoke, own, dependent, sourceGuard]

        it('reads the copy number GitLab sets and stays whole without it', () => {
            expect(shardFromEnv({})).toBeNull()
            // What GitLab sets for a job without `parallel`: a total of 1 and no index.
            expect(shardFromEnv({ CI_NODE_TOTAL: '1' })).toBeNull()
            expect(shardFromEnv({ CI_NODE_TOTAL: '1', CI_NODE_INDEX: '1' })).toBeNull()
            expect(shardFromEnv({ CI_NODE_TOTAL: '4', CI_NODE_INDEX: '3' })).toEqual({ index: 3, total: 4 })
            expect(() => shardFromEnv({ CI_NODE_TOTAL: '4', CI_NODE_INDEX: '5' })).toThrow('CI_NODE_INDEX')
            expect(() => shardFromEnv({ CI_NODE_TOTAL: '4' })).toThrow('CI_NODE_INDEX')
        })
        it('is not split by the environment of the job these tests themselves run in', () => {
            // The gate's own suite runs inside a split job, with CI_NODE_TOTAL set.
            const saved = { total: process.env.CI_NODE_TOTAL, index: process.env.CI_NODE_INDEX }
            process.env.CI_NODE_TOTAL = '4'
            process.env.CI_NODE_INDEX = '2'
            try {
                writePlan(plan)
                const runProcess = processRunner()
                expect(run({ root, runProcess })).toBe(0)
                expect(suitesRun(runProcess).sort()).toEqual([dependent, own].sort())
            } finally {
                for (const [key, value] of [
                    ['CI_NODE_TOTAL', saved.total],
                    ['CI_NODE_INDEX', saved.index],
                ]) {
                    if (value === undefined) delete process.env[key]
                    else process.env[key] = value
                }
            }
        })
        it('runs every suite of the complete run exactly once across the copies', () => {
            const parts = shares(() => processRunner())
            const ran = parts.flatMap(part => part || [])
            expect([...ran].sort()).toEqual(everySuite().sort())
            expect(new Set(ran).size).toBe(ran.length)
        })
        it('runs every selected suite exactly once across the copies', () => {
            writePlan(plan)
            const ran = shares(() => processRunner()).flatMap(part => part || [])
            expect([...ran].sort()).toEqual([dependent, own].sort())
        })
        it('lets a copy without any of the selected suites pass, and says so', () => {
            writePlan(plan)
            const empty = Array.from({ length: TOTAL }, (_, i) => i + 1).find(
                index => ![own, dependent].some(file => inShard(root, file, { index, total: TOTAL }))
            )
            expect(empty).toBeDefined()
            const runProcess = processRunner()
            const log = jest.spyOn(console, 'log').mockImplementation(() => {})
            try {
                expect(run({ root, runProcess, shard: { index: empty, total: TOTAL } })).toBe(0)
                expect(log.mock.calls.flat().join('\n')).toContain('the other parts run them')
            } finally {
                log.mockRestore()
            }
            // Discovery may ask Jest; no suite is run.
            expect(suitesRun(runProcess)).toBeNull()
            expect(runProcess.mock.calls.filter(([, args]) => args.includes('--runTestsByPath'))).toHaveLength(0)
        })
        it('still covers its share of the selected suites when one copy falls back to every suite', () => {
            // That copy's dependency discovery failed, the others' did not. Split by position
            // in the list, its share of "every suite" would miss suites the others leave to it.
            writePlan(plan)
            const failing = 2
            const discoveryFailsOnce = () => {
                const working = processRunner()
                let listed = 0
                return jest.fn((command, args) => {
                    if (command !== 'git' && args.includes('--listTests') && listed++ === 0) return { status: 1 }
                    return working(command, args)
                })
            }
            const parts = shares(index => (index === failing ? discoveryFailsOnce() : processRunner()))
            const ran = parts.flatMap(part => part || [])
            expect(ran).toEqual(expect.arrayContaining([own, dependent]))
            for (const file of everySuite())
                expect((parts[failing - 1] || []).includes(file)).toBe(
                    inShard(root, file, { index: failing, total: TOTAL })
                )
        })
        it('runs everything in a copy that cannot list the suites at all', () => {
            const runProcess = processRunner({ discoveryFails: true })
            expect(quiet(() => run({ root, runProcess, shard: { index: 1, total: TOTAL } }))).toBe(0)
            expect(runProcess.mock.calls.at(-1)[1]).not.toContain('--runTestsByPath')
            expect(runProcess.mock.calls.at(-1)[1].join(' ')).not.toContain('--shard')
        })
        it('fails rather than passes when there is no suite to split', () => {
            const none = jest.fn((command, args) =>
                command === 'git'
                    ? { status: 0, stdout: head }
                    : args.includes('--listTests')
                      ? { status: 0, stdout: '[]' }
                      : { status: 0 }
            )
            expect(() => quiet(() => run({ root, runProcess: none, shard: { index: 1, total: TOTAL } }))).toThrow(
                'discovered no web tests'
            )
        })
    })

    it.each(['components/Foo.js', 'components/payload.json'])(
        'selects transitive consumers of %s through the actual Jest dependency graph',
        input => {
            write('components/payload.json', '{"value":1}')
            write('components/Foo.js', "module.exports = require('./payload.json').value")
            write('components/Bar.js', "module.exports = require('./Foo')")
            write('components/Foo.test.js', "require('./Foo'); test('foo', () => {})")
            write('components/Bar.test.js', "require('./Bar'); test('bar', () => {})")
            fs.unlinkSync(sourceGuard)
            const graph = extra =>
                JSON.parse(
                    execFileSync(
                        process.execPath,
                        [
                            require.resolve('jest/bin/jest'),
                            '--config',
                            JSON.stringify({ rootDir: root, testEnvironment: 'node' }),
                            '--runInBand',
                            '--listTests',
                            '--json',
                            ...extra,
                        ],
                        { cwd: root, encoding: 'utf8' }
                    )
                )
            expect(resolveSuites(root, { ...plan, inputs: [input, 'components/Foo.test.js'] }, graph).suites).toEqual(
                expect.arrayContaining([own, dependent])
            )
        },
        30000
    )
})
