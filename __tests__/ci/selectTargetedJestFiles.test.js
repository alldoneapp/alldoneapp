// The selector is what decides whether test:web:changed runs any suite at all.
// Its failure modes used to be indistinguishable from a clean run - an empty
// stdout piped into `xargs -r` reported success either way - so the contract
// under test here is the exit code: only a genuinely empty selection may be
// zero, everything else has to fail loudly.

const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SELECTOR = path.resolve(__dirname, '../../ci/selectTargetedJestFiles.js')

const EXIT_UNRESOLVED_REF = 3
const EXIT_NO_MERGE_BASE = 4

const git = (cwd, args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const createRepo = () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'targeted-jest-')))
    git(dir, ['init', '--quiet'])
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
    const result = spawnSync(process.execPath, [SELECTOR, ...args], { cwd: dir, encoding: 'utf8' })
    return {
        status: result.status,
        files: String(result.stdout || '')
            .split('\0')
            .filter(Boolean),
        stderr: String(result.stderr || ''),
    }
}

describe('ci/selectTargetedJestFiles.js', () => {
    let repo

    beforeEach(() => {
        repo = createRepo()
    })

    afterEach(() => {
        removeRepo(repo)
    })

    it('selects changed tests and the sources no changed test already covers', () => {
        write(repo, 'components/Foo.js', 'export const foo = 1\n')
        write(repo, 'functions/Assistant/vmJob.js', 'module.exports = {}\n')
        write(repo, 'README.md', 'docs\n')
        const base = commit(repo, 'base')

        write(repo, 'components/Foo.js', 'export const foo = 2\n')
        write(repo, 'components/Bar.js', 'export const bar = 1\n')
        write(repo, 'components/Bar.test.js', "it('bars', () => {})\n")
        write(repo, 'functions/Assistant/vmJob.js', 'module.exports = { changed: true }\n')
        write(repo, '__mocks__/firebase.js', 'module.exports = {}\n')
        write(repo, 'README.md', 'docs changed\n')
        const head = commit(repo, 'branch work')

        const { status, files, stderr } = runSelector(repo, [base, head])

        expect(status).toBe(0)
        // Bar.js is left out because its co-located test changed with it;
        // functions/, __mocks__/ and non-code files never take part.
        expect(files).toEqual([path.normalize('components/Bar.test.js'), path.normalize('components/Foo.js')])
        expect(stderr).toContain('Targeted Jest selection: 2 file(s)')
    }, 30000)

    it('fails instead of selecting nothing when the base ref does not exist', () => {
        write(repo, 'components/Foo.js', 'export const foo = 1\n')
        commit(repo, 'base')

        const { status, files, stderr } = runSelector(repo, ['origin/master'])

        expect(status).toBe(EXIT_UNRESOLVED_REF)
        expect(files).toEqual([])
        expect(stderr).toContain('cannot resolve base ref "origin/master"')
    }, 30000)

    it('fails instead of selecting nothing when the refs share no history', () => {
        write(repo, 'components/Foo.js', 'export const foo = 1\n')
        const base = commit(repo, 'base')

        git(repo, ['checkout', '--quiet', '--orphan', 'unrelated'])
        git(repo, ['rm', '-rq', '--cached', '.'])
        fs.unlinkSync(path.join(repo, 'components/Foo.js'))
        write(repo, 'components/Baz.js', 'export const baz = 1\n')
        const head = commit(repo, 'unrelated root')

        const { status, files, stderr } = runSelector(repo, [base, head])

        expect(status).toBe(EXIT_NO_MERGE_BASE)
        expect(files).toEqual([])
        expect(stderr).toContain('no common ancestor')
    }, 30000)

    it('selects nothing and passes when the base already contains the commit under test', () => {
        write(repo, 'components/Foo.js', 'export const foo = 1\n')
        const head = commit(repo, 'base')

        write(repo, 'components/Foo.js', 'export const foo = 2\n')
        const base = commit(repo, 'merged into the base branch')

        const { status, files, stderr } = runSelector(repo, [base, head])

        expect(status).toBe(0)
        expect(files).toEqual([])
        expect(stderr).toContain('already contains')
    }, 30000)

    it('selects nothing and passes when the branch changes no web-relevant code', () => {
        write(repo, 'components/Foo.js', 'export const foo = 1\n')
        const base = commit(repo, 'base')

        write(repo, 'README.md', 'docs only\n')
        const head = commit(repo, 'docs only')

        const { status, files, stderr } = runSelector(repo, [base, head])

        expect(status).toBe(0)
        expect(files).toEqual([])
        expect(stderr).toContain('nothing to do')
    }, 30000)
})
