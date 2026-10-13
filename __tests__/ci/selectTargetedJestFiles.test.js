// Selection uncertainty must run the complete suite, never silently select zero
// tests. Exact deployment ranges also include superseded work and reverts.

const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SELECTOR = path.resolve(__dirname, '../../ci/selectTargetedJestFiles.js')

const { selectPlan, makePlan } = require('../../ci/selectTargetedJestFiles')

// `cwd` alone does NOT decide which repository a git command talks to: the pointer variables win
// over it. If `GIT_DIR`/`GIT_WORK_TREE` are exported by the surrounding environment, `git init`
// in a scratch directory silently succeeds WITHOUT creating a repository there, and every command
// after it - `git config user.email`, `git add -A`, `git commit` - operates on the inherited
// repository instead. This suite would then rewrite the checkout it is running inside: observed
// in an Alldone VM agent job (whose sandbox exports both, see the Codex git-metadata note in
// CLAUDE.md), where a full `npx jest` run committed the agent's uncommitted work as "base".
//
// So the fixtures run with the whole pointer family stripped. `--quiet` is also dropped from
// `init` deliberately - see `createRepo`.
const GIT_POINTER_VARS = [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CEILING_DIRECTORIES',
]

const scratchEnv = () => {
    const env = { ...process.env }
    GIT_POINTER_VARS.forEach(name => delete env[name])
    return env
}

const git = (cwd, args) =>
    execFileSync('git', args, {
        cwd,
        env: scratchEnv(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

const createRepo = () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'targeted-jest-')))
    git(dir, ['init'])
    // Assert the scratch repo is really the scratch repo before anything writes to it. Without
    // this, a future environment that reintroduces a pointer variable would not fail here - it
    // would quietly commit into whatever repository the suite happens to be running inside, and
    // the only symptom would be a mystery commit.
    const toplevel = git(dir, ['rev-parse', '--show-toplevel'])
    if (fs.realpathSync(toplevel) !== dir) {
        throw new Error(`Refusing to run: scratch repo resolved to ${toplevel} instead of ${dir}`)
    }
    git(dir, ['config', 'user.email', 'ci@example.com'])
    git(dir, ['config', 'user.name', 'CI'])
    git(dir, ['config', 'commit.gpgsign', 'false'])
    return dir
}

const removeRepo = dir =>
    fs.rmSync ? fs.rmSync(dir, { recursive: true, force: true }) : fs.rmdirSync(dir, { recursive: true })

const write = (dir, file, contents) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), contents)
}

const commit = (dir, message) => {
    git(dir, ['add', '-A'])
    git(dir, ['commit', '--quiet', '--no-verify', '-m', message])
    return git(dir, ['rev-parse', 'HEAD'])
}

const runSelector = (dir, args) => {
    const output = path.join(dir, 'plan.json')
    const result = spawnSync(process.execPath, [SELECTOR, ...args, output, String(Date.now() / 1000)], {
        cwd: dir,
        env: scratchEnv(),
        encoding: 'utf8',
    })
    return {
        status: result.status,
        plan: fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : null,
    }
}

const recent = 100000
const policy = changes =>
    selectPlan({
        changes,
        base: 'base',
        head: 'head',
        lastFullTestedAt: recent,
        now: recent + 10,
    })
const changed = (file, status = 'M') => ({ file, status })

describe('web test selection policy', () => {
    it('keeps the source when its co-located test changes, and includes shared JSON', () => {
        const plan = policy([
            changed('components/Bar.js'),
            changed('components/Bar.test.js'),
            changed('components/data.json'),
        ])
        expect(plan.mode).toBe('targeted')
        expect(plan.inputs).toEqual(['components/Bar.js', 'components/Bar.test.js', 'components/data.json'])
    })
    it.each([
        'App.js',
        'package-lock.json',
        'babel.config.js',
        '__mocks__/firebase.js',
        'i18n/translations/de.json',
        'redux/store.js',
    ])('runs the full suite for broad changes: %s', file => {
        expect(policy([changed(file)]).mode).toBe('full')
    })
    it.each(['components/anna.css', 'assets/logo.png'])(
        'uses the full suite for changes Jest cannot trace: %s',
        file => {
            expect(policy([changed(file)]).mode).toBe('full')
        }
    )
    it('uses the full suite for deleted dependencies, including renames represented as delete/add', () => {
        expect(policy([changed('utils/old.js', 'D'), changed('utils/new.js', 'A')]).mode).toBe('full')
    })
    it('retains snapshots as Jest dependency inputs', () => {
        expect(policy([changed('__tests__/__snapshots__/Foo.test.js.snap')]).inputs).toEqual([
            '__tests__/__snapshots__/Foo.test.js.snap',
        ])
    })
    it.each([undefined, 0, recent - 86400, recent + 20])(
        'selects affected suites independently of the previous full-run time: %s',
        lastFullTestedAt => {
            expect(
                selectPlan({
                    changes: [changed('utils/a.js')],
                    base: 'base',
                    head: 'head',
                    lastFullTestedAt,
                    now: recent,
                }).mode
            ).toBe('targeted')
        }
    )
    it('does not run tests when no test inputs changed, even after 24 hours', () => {
        expect(
            selectPlan({
                changes: [],
                base: 'base',
                head: 'head',
                lastFullTestedAt: recent,
                now: recent + 86400,
            }).mode
        ).toBe('none')
    })
    it('selects CI changes without treating every pipeline edit as application-wide', () => {
        expect(policy([changed('ci/runWebTests.js'), changed('.gitlab-ci.yml')]).mode).toBe('targeted')
    })
    it('maps deployment scripts and path lists through source-reading tests', () => {
        const inputs = ['ci/deployScope.sh', 'ci/deploy-scope/web-production.paths']
        const plan = policy(inputs.map(file => changed(file)))
        expect(plan.mode).toBe('targeted')
        expect(plan.inputs).toEqual(inputs.sort())
        expect(policy([changed('utils/unknown.sh')]).mode).toBe('full')
    })
    it('selects backend runtime dependencies and test changes without unrelated frontend changes', () => {
        expect(
            selectPlan({
                kind: 'functions',
                base: 'base',
                head: 'head',
                runtimeFiles: ['utils/shared.js'],
                changes: [
                    changed('functions/MenubarApp/writer.js'),
                    changed('functions/MenubarApp/writer.test.js'),
                    changed('utils/shared.js'),
                    changed('components/Unrelated.js'),
                ],
            }).inputs
        ).toEqual(['functions/MenubarApp/writer.js', 'functions/MenubarApp/writer.test.js', 'utils/shared.js'])
    })
    it('ignores backend/docs-only changes when a recent full validation exists', () => {
        expect(policy([changed('functions/Assistant/foo.js'), changed('README.md')]).mode).toBe('none')
    })
})

describe('committed comparison ranges', () => {
    let repo
    beforeEach(() => {
        repo = createRepo()
    })
    afterEach(() => removeRepo(repo))

    it('includes all changes since the deployed commit, including a skipped earlier pipeline', () => {
        write(repo, 'components/Foo.js', 'export const foo = 1\n')
        const base = commit(repo, 'deployed')
        write(repo, 'components/Foo.js', 'export const foo = 2\n')
        commit(repo, 'superseded pipeline')
        write(repo, 'components/Bar.js', 'export const bar = 1\n')
        write(repo, 'components/Bar.test.js', "it('bars', () => {})\n")
        const head = commit(repo, 'next release')
        const { status, plan } = runSelector(repo, [base, head])
        expect(status).toBe(0)
        expect(plan.base).toBe(base)
        expect(plan.inputs).toEqual(['components/Bar.js', 'components/Bar.test.js', 'components/Foo.js'])
    }, 30000)

    it('falls back to all suites for an unavailable deployment marker', () => {
        write(repo, 'components/Foo.js', 'export const foo = 1\n')
        const head = commit(repo, 'base')
        expect(runSelector(repo, ['missing', head]).plan.mode).toBe('full')
        expect(runSelector(repo, ['', head]).plan.mode).toBe('full')
    }, 30000)

    it('fails if the actual checkout under test cannot be resolved', () => {
        const result = runSelector(repo, ['', 'missing-head'])
        expect(result.status).not.toBe(0)
        expect(result.plan).toBeNull()
    }, 30000)

    it('compares exact trees even when the deployed marker is not an ancestor', () => {
        write(repo, 'components/Foo.js', 'export const foo = 1\n')
        const ancestor = commit(repo, 'base')
        write(repo, 'components/Foo.js', 'export const foo = 2\n')
        const deployed = commit(repo, 'deployed on old branch')
        git(repo, ['checkout', '--quiet', '-b', 'replacement', ancestor])
        write(repo, 'components/Foo.js', 'export const foo = 3\n')
        const head = commit(repo, 'replacement release')
        expect(runSelector(repo, [deployed, head]).plan.inputs).toEqual(['components/Foo.js'])
    }, 30000)

    it('preserves branch merge-base comparison without the deployment cadence', () => {
        write(repo, 'components/Foo.js', 'export const foo = 1\n')
        const base = commit(repo, 'base')
        git(repo, ['checkout', '--quiet', '-b', 'feature'])
        write(repo, 'components/Foo.js', 'export const foo = 2\n')
        const head = commit(repo, 'feature')
        expect(makePlan(repo, base, head, { branch: true }).mode).toBe('targeted')
        expect(makePlan(repo, head, head, { branch: true }).mode).toBe('none')
    }, 30000)

    it('uses a shallow deployment marker without requiring a merge base', () => {
        write(repo, 'components/Foo.js', 'module.exports = 1')
        const base = commit(repo, 'deployed')
        git(repo, ['tag', 'deployed/web-production', base])
        write(repo, 'components/Foo.js', 'module.exports = 2')
        commit(repo, 'next release')
        const checkout = path.join(repo, 'shallow-checkout')
        git(repo, ['clone', '--depth=1', '--no-tags', `file://${repo}`, checkout])
        git(checkout, [
            'fetch',
            '--depth=1',
            'origin',
            'refs/tags/deployed/web-production:refs/tags/deployed/web-production',
        ])
        expect(git(checkout, ['rev-parse', '--is-shallow-repository'])).toBe('true')
        const result = runSelector(checkout, [base, 'HEAD'])
        expect(result.plan.mode).toBe('targeted')
        expect(result.plan.inputs).toEqual(['components/Foo.js'])
    }, 30000)

    it('catches up skipped rules tests before the first dedicated test marker', () => {
        write(repo, 'functions/index.js', 'exports.alpha = () => 1')
        write(repo, 'firestore.rules', 'rules_version = 2;')
        write(repo, '__tests__/Firestore/rules.test.js', "test('base', () => {})")
        const base = commit(repo, 'tested rules')
        for (const target of [
            'web-production',
            'functions-production',
            'runner-production',
            'firestore-rules-production',
        ])
            git(repo, ['tag', `deployed/${target}`, base])
        write(repo, '__tests__/Firestore/rules.test.js', "test('new rules regression', () => {})")
        const skipped = commit(repo, 'superseded test pipeline')
        write(repo, 'components/Foo.js', 'module.exports = 1')
        const head = commit(repo, 'next pipeline')
        const remote = path.join(repo, 'remote.git')
        git(repo, ['clone', '--bare', repo, remote])
        git(repo, ['remote', 'add', 'origin', `file://${remote}`])
        execFileSync('sh', [path.resolve(__dirname, '../../ci/deployScope.sh'), 'compute'], {
            cwd: repo,
            encoding: 'utf8',
            env: {
                ...scratchEnv(),
                CI_PROJECT_DIR: repo,
                CI_COMMIT_SHA: head,
                CI_COMMIT_BEFORE_SHA: skipped,
                DEPLOY_SCOPE_PATHS_DIR: path.resolve(__dirname, '../../ci/deploy-scope'),
            },
        })
        expect(fs.readFileSync(path.join(repo, 'deploy-scope.env'), 'utf8')).toContain('DEPLOY_FIRESTORE_TESTS=1')
    }, 30000)

    it('publishes the exact verified deployment baseline and full-validation time in the CI scope artifact', () => {
        write(repo, 'components/Foo.js', 'module.exports = 1')
        write(repo, 'functions/index.js', 'exports.alpha = () => 1')
        const base = commit(repo, 'deployed')
        for (const target of [
            'web-production',
            'functions-production',
            'runner-production',
            'firestore-rules-production',
        ])
            git(repo, ['tag', `deployed/${target}`, base])
        git(repo, ['tag', '--annotate', 'deployed/web-full-tests', base, '--message', 'Validated'])
        write(repo, 'components/Foo.js', 'module.exports = 2')
        const head = commit(repo, 'next release')
        const remote = path.join(repo, 'remote.git')
        git(repo, ['clone', '--bare', repo, remote])
        git(repo, ['remote', 'add', 'origin', `file://${remote}`])
        try {
            execFileSync('sh', [path.resolve(__dirname, '../../ci/deployScope.sh'), 'compute'], {
                cwd: repo,
                encoding: 'utf8',
                env: {
                    ...scratchEnv(),
                    CI_PROJECT_DIR: repo,
                    CI_COMMIT_SHA: head,
                    CI_COMMIT_BEFORE_SHA: base,
                    DEPLOY_SCOPE_PATHS_DIR: path.resolve(__dirname, '../../ci/deploy-scope'),
                },
            })
        } catch (error) {
            throw new Error(String(error.stdout) + String(error.stderr))
        }
        const scope = fs.readFileSync(path.join(repo, 'deploy-scope.env'), 'utf8')
        const plan = JSON.parse(fs.readFileSync(path.join(repo, 'web-test-scope.json'), 'utf8'))
        expect(scope).toContain('DEPLOY_WEB_PRODUCTION=1')
        expect(scope).toContain('DEPLOY_FUNCTIONS_PRODUCTION=0')
        expect(plan).toMatchObject({
            base,
            head,
            mode: 'targeted',
            inputs: ['components/Foo.js'],
        })
    }, 30000)
})
