/** @jest-environment node */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { selectDeployment, makePlan } = require('../ci/selectFunctionsDeployment')
const { validatePlan } = require('../ci/functionsDeploymentPlan')
const { deploymentFilters, run } = require('../ci/runFunctionsDeployment')
const { assertCompletedDeployment, findMissingFunctions } = require('../ci/assertFirebaseFunctionsDeployed')

const tree = files => ({ files: new Set(Object.keys(files)), read: file => files[file] ?? null })
const fixture = {
    'functions/index.js': `
const shared = require('./shared')
function helper() { return shared.value }
exports.alpha = () => helper()
exports.beta = () => require('./beta').run()
exports.gamma = () => 'unchanged'
`,
    'functions/shared.js': "module.exports = require('../utils/common')",
    'utils/common.js': 'exports.value = 1',
    'functions/beta.js': "module.exports = require('./shared')",
    'firebase.json': '{"functions":{"runtime":"nodejs22"},"hosting":{}}',
}
const select = (changes, base = fixture) => {
    const next = { ...base, ...changes }
    Object.keys(next).forEach(file => {
        if (next[file] === null) delete next[file]
    })
    return selectDeployment({ before: tree(base), after: tree(next), changed: Object.keys(changes) })
}

describe('function dependency selection', () => {
    it('selects only callers of a changed module, including transitive callers outside functions', () => {
        expect(select({ 'functions/beta.js': 'exports.run = () => 2' }).names).toEqual(['beta'])
        expect(select({ 'utils/common.js': 'exports.value = 2' }).names).toEqual(['alpha', 'beta'])
    })
    it('selects changed export bodies and shared entrypoint helpers independently', () => {
        expect(
            select({ 'functions/index.js': fixture['functions/index.js'].replace("'unchanged'", "'changed'") }).names
        ).toEqual(['gamma'])
        expect(
            select({ 'functions/index.js': fixture['functions/index.js'].replace('shared.value', 'shared.value + 1') })
                .names
        ).toEqual(['alpha'])
    })
    it('ignores formatting, comments, unreferenced tests and documentation', () => {
        expect(select({ 'functions/index.js': '// comment\n' + fixture['functions/index.js'] }).mode).toBe('none')
        expect(
            select({
                'functions/foo.test.js': 'test()',
                'functions/README.md': '# Docs',
                'components/View.js': 'new UI',
            }).mode
        ).toBe('none')
    })
    it('does not ignore a test-named file actually imported by production', () => {
        const base = {
            ...fixture,
            'functions/shared.js': "module.exports = require('./data.test')",
            'functions/data.test.js': 'exports.value = 1',
        }
        expect(select({ 'functions/data.test.js': 'exports.value = 2' }, base).names).toEqual(['alpha', 'beta'])
    })
    it('follows static dynamic imports, re-exports, directory imports and cycles', () => {
        const base = {
            ...fixture,
            'functions/shared.js': "export { value } from './lib'; export * from './cycle'",
            'functions/lib/index.js': "export const value = import('../payload.json')",
            'functions/cycle.js': "require('./shared')",
            'functions/payload.json': '{"value":1}',
        }
        expect(select({ 'functions/payload.json': '{"value":2}' }, base).names).toEqual(['alpha', 'beta'])
    })
    it('traces TypeScript and JSX shared imports without forcing unrelated frontend changes to deploy', () => {
        const base = {
            ...fixture,
            'utils/common.js': "export * from './typed'",
            'utils/typed.ts': 'export const value: number = 1',
        }
        expect(select({ 'utils/typed.ts': 'export const value: number = 2' }, base).names).toEqual(['alpha', 'beta'])
        expect(select({ 'components/Unrelated.tsx': 'export const View = () => <div />' }, base).mode).toBe('none')
    })
    it('includes dependency removals and changed import edges', () => {
        expect(select({ 'functions/beta.js': 'exports.run = () => 4', 'functions/shared.js': null }).names).toEqual([
            'alpha',
            'beta',
        ])
    })
    it('selects new exports and fully reconciles removed or renamed exports', () => {
        expect(
            select({ 'functions/index.js': fixture['functions/index.js'] + '\nexports.delta = () => 1' }).names
        ).toEqual(['delta'])
        expect(
            select({ 'functions/index.js': fixture['functions/index.js'].replace('exports.gamma', 'exports.renamed') })
                .mode
        ).toBe('full')
    })
    it('includes shared initialization and its ordering in every export', () => {
        const base = {
            ...fixture,
            'functions/index.js': 'const setup = initialize(1);\nfirst();\nsecond();\n' + fixture['functions/index.js'],
        }
        expect(
            select({ 'functions/index.js': base['functions/index.js'].replace('initialize(1)', 'initialize(2)') }, base)
                .names
        ).toEqual(['alpha', 'beta', 'gamma'])
        expect(
            select(
                {
                    'functions/index.js': base['functions/index.js'].replace(
                        'first();\nsecond();',
                        'second();\nfirst();'
                    ),
                },
                base
            ).names
        ).toEqual(['alpha', 'beta', 'gamma'])
    })
    it('deploys uncertain dynamic dependencies conservatively', () => {
        const base = { ...fixture, 'functions/beta.js': 'module.exports = require(process.env.MODULE)' }
        expect(select({ 'utils/newDynamic.js': 'module.exports = 1' }, base).names).toEqual(['beta'])
        expect(select({ 'functions/shared.js': 'exports.value = 2' }, base).names).toEqual(['alpha', 'beta'])
    })
    it.each([
        'functions/package-lock.json',
        'functions/package.json',
        'functions/firebaseConfig.js',
        'functions/unmapped.js',
        'functions/template.html',
        'functions/assistant-prompt.md',
    ])('selects all functions for an unbounded runtime change: %s', file => {
        expect(select({ [file]: '{}' }).mode).toBe('full')
    })
    it('distinguishes Functions configuration from Hosting-only changes', () => {
        expect(
            select({ 'firebase.json': '{"functions":{"runtime":"nodejs22"},"hosting":{"public":"new"}}' }).mode
        ).toBe('none')
        expect(select({ 'firebase.json': '{"functions":{"runtime":"nodejs24"}}' }).mode).toBe('full')
    })
    it('never uses an unknown deployment baseline to skip functions', () => {
        expect(selectDeployment({ before: null, after: tree(fixture), changed: [] }).mode).toBe('full')
        expect(selectDeployment({ before: tree(fixture), after: tree(fixture), changed: [], force: true }).mode).toBe(
            'full'
        )
    })
    it('fails closed on unsupported export forms', () => {
        expect(() => select({ 'functions/index.js': 'exports[process.env.NAME] = () => 1' })).toThrow(
            'Dynamic function export'
        )
        expect(() =>
            select({
                'functions/index.js': fixture['functions/index.js'] + '\nObject.assign(exports, { delta: () => 1 })',
            })
        ).toThrow('Unsupported function export reference')
    })
})

describe('selection across commits and failed deployments', () => {
    it('catches a superseded backend commit from the deployment marker, ignoring dirty worktree edits', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'function-history-'))
        const git = (...args) =>
            execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
        const write = (file, value) => {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
            fs.writeFileSync(path.join(root, file), value)
        }
        const commit = () => {
            git('add', '.')
            git(
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.test',
                '-c',
                'core.hooksPath=/dev/null',
                'commit',
                '-qm',
                'Fixture'
            )
            return git('rev-parse', 'HEAD')
        }
        try {
            git('init', '-q')
            Object.entries(fixture).forEach(([file, value]) => write(file, value))
            const base = commit()
            write('functions/beta.js', 'exports.run = () => 3')
            commit() // Never successfully deployed.
            write('components/View.js', 'UI change')
            const head = commit()
            write('functions/shared.js', 'uncommitted change')
            expect(makePlan(root, base, head)).toMatchObject({ mode: 'partial', names: ['beta'], base, head })
            expect(makePlan(root, '', head).mode).toBe('full')
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})

describe('serialized deployment marker refresh', () => {
    it('repairs partial deployments even when the next commit reverts to the last successful source', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'function-markers-'))
        const root = path.join(dir, 'work')
        const remote = path.join(dir, 'remote.git')
        fs.mkdirSync(root)
        const git = (...args) =>
            execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
        const write = (file, value) => {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
            fs.writeFileSync(path.join(root, file), value)
        }
        const commit = () => {
            git('add', 'functions', 'utils', 'firebase.json')
            git(
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.test',
                '-c',
                'core.hooksPath=/dev/null',
                'commit',
                '-qm',
                'Fixture'
            )
            return git('rev-parse', 'HEAD')
        }
        try {
            git('init', '-q')
            git('init', '--bare', '-q', remote)
            git('remote', 'add', 'origin', remote)
            Object.entries(fixture).forEach(([file, value]) => write(file, value))
            const baseline = commit()
            write('functions/beta.js', 'exports.run = () => 3')
            const attempt = commit()
            write('functions/beta.js', fixture['functions/beta.js'])
            const head = commit()
            git(
                'push',
                '-q',
                'origin',
                `${baseline}:refs/tags/deployed/functions-production`,
                `${attempt}:refs/tags/deployed/functions-production-attempt`
            )
            expect(makePlan(root, baseline, head).mode).toBe('none')
            const refresh = () =>
                spawnSync(
                    'sh',
                    [path.resolve(__dirname, '../ci/deployScope.sh'), 'functions-plan', 'functions-production'],
                    {
                        encoding: 'utf8',
                        env: { ...process.env, CI_PROJECT_DIR: root, CI_COMMIT_SHA: head, FUNCTIONS_DEPLOY_ALL: '0' },
                    }
                )
            const first = refresh()
            expect(first.status).toBe(0)
            expect(JSON.parse(fs.readFileSync(path.join(root, 'functions-deploy-scope.json'))).mode).toBe('full')
            // If the preceding job completed after pipeline scope was computed,
            // re-reading its successful marker also picks up a necessary rollback.
            git('push', '--force', '-q', 'origin', `${attempt}:refs/tags/deployed/functions-production`)
            expect(refresh().status).toBe(0)
            expect(JSON.parse(fs.readFileSync(path.join(root, 'functions-deploy-scope.json'))).names).toEqual(['beta'])
            git(
                'push',
                '--force',
                '-q',
                'origin',
                `${head}:refs/tags/deployed/functions-production`,
                `${head}:refs/tags/deployed/functions-production-attempt`
            )
            expect(refresh().status).toBe(76)
            // No credentials means no safe attempt marker: fail before any Firebase call.
            const begin = spawnSync(
                'sh',
                [path.resolve(__dirname, '../ci/deployScope.sh'), 'functions-begin', 'functions-production'],
                {
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        CI_PROJECT_DIR: root,
                        CI_COMMIT_SHA: head,
                        CI_JOB_TOKEN: '',
                        DEPLOY_MARKER_TOKEN: '',
                    },
                }
            )
            expect(begin.status).toBe(1)
            expect(begin.stdout).toContain('Cannot record Functions attempt')
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})

describe('function deployment execution and completion', () => {
    const names = Array.from({ length: 23 }, (_, i) => `fn${i}`)
    const plan = { version: 1, mode: 'partial', head: 'abc', names }
    it('batches explicit function names, at most ten per Firebase command', () => {
        const filters = deploymentFilters(plan)
        expect(filters.map(filter => filter.split(',').length)).toEqual([10, 10, 3])
        expect(filters.join(',').split(',')).toEqual(names.map(name => `functions:${name}`))
        expect(deploymentFilters({ ...plan, mode: 'full' })).toEqual(['functions'])
    })
    it('rejects stale, unknown, empty and duplicated selections', () => {
        expect(() => validatePlan(plan, names, 'another')).toThrow('another commit')
        expect(() => validatePlan({ ...plan, names: ['unknown'] }, names, 'abc')).toThrow('unknown')
        expect(() => validatePlan({ ...plan, names: [] }, names, 'abc')).toThrow('Empty')
        expect(() => validatePlan({ ...plan, names: ['fn1', 'fn1'] }, names, 'abc')).toThrow('duplicate')
        expect(() => deploymentFilters({ ...plan, mode: 'none', names: [] })).toThrow('No Functions selected')
    })
    it('stops at a failed batch and stamps runtime-only changes into uploaded source', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'function-run-'))
        try {
            fs.mkdirSync(path.join(root, 'functions'))
            fs.writeFileSync(
                path.join(root, 'functions/index.js'),
                names.map(name => `exports.${name} = () => {}`).join('\n')
            )
            fs.writeFileSync(path.join(root, 'functions-deploy-scope.json'), JSON.stringify(plan))
            const spawn = jest.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 17 })
            expect(run({ root, head: 'abc', args: ['--non-interactive'], spawn })).toBe(17)
            expect(spawn).toHaveBeenCalledTimes(2)
            expect(spawn.mock.calls[0][1]).toContain('--non-interactive')
            expect(JSON.parse(fs.readFileSync(path.join(root, 'functions/ci-deployment.json'), 'utf8'))).toEqual({
                head: 'abc',
                names,
            })
            fs.unlinkSync(path.join(root, 'functions-deploy-scope.json'))
            const fallbackSpawn = jest.fn().mockReturnValue({ status: 0 })
            expect(run({ root, head: 'def', args: [], spawn: fallbackSpawn })).toBe(0)
            expect(fallbackSpawn.mock.calls[0][1]).toEqual(['deploy', '--only', 'functions'])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
    it('requires completion only for selected functions while retaining the full inventory guard', () => {
        const source = 'exports.alpha = () => 1\nexports.beta = () => 2'
        const log = 'functions[alpha(europe-west1)] Successful update operation.\nDeploy complete!'
        expect(() => assertCompletedDeployment(source, log, ['alpha'])).not.toThrow()
        expect(() => assertCompletedDeployment(source, log, ['alpha', 'beta'])).toThrow('beta')
        expect(findMissingFunctions(source, [{ id: 'alpha' }])).toEqual(['beta'])
    })
})
