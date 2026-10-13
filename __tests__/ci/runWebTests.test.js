/** @jest-environment node */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { resolveSuites, run } = require('../../ci/runWebTests')
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
