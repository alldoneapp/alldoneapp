/** @jest-environment node */
// Who may move a production deploy marker (security audit 2026-11, NV-01).
//
// `deployed/*` tags decide what production ships: a marker pointing at a commit whose
// target files equal master's makes that deploy report "already deployed". The tags cannot
// be protected (CI force-moves them), so ci/deployScope.sh only believes a production
// marker that a protected default-branch pipeline signed, that is an ancestor of the commit
// under test, and it reads changes from the whole range so a replayed older marker cannot
// hide a revert. These tests drive the REAL script against REAL git repositories; a fake
// git cannot tell a signed annotated tag from a lightweight one.
const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..')
const SCOPE_SCRIPT = path.join(REPO_ROOT, 'ci', 'deployScope.sh')
const NOT_NEEDED = 76
const KEY = 'test-signing-key-0123456789abcdef'
const RULES = 'firestore-rules-production'
const RULES_REF = `refs/tags/deployed/${RULES}`

const hasTool = tool => spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0

function makeFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-markers-'))
    const remote = path.join(dir, 'remote.git')
    const work = path.join(dir, 'work')
    const git = (cwd, ...args) =>
        execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git(dir, 'init', '-q', '--bare', remote)
    git(dir, 'init', '-q', '-b', 'master', work)
    git(work, 'remote', 'add', 'origin', remote)
    const commit = (file, content, message = 'change') => {
        fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true })
        fs.writeFileSync(path.join(work, file), content)
        git(work, 'add', '-A')
        git(
            work,
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.test',
            '-c',
            'core.hooksPath=/dev/null',
            'commit',
            '-qm',
            message
        )
        return git(work, 'rev-parse', 'HEAD')
    }
    const env = (overrides = {}) => ({
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CI_PROJECT_DIR: work,
        CI_DEFAULT_BRANCH: 'master',
        CI_COMMIT_BRANCH: 'master',
        CI_COMMIT_REF_PROTECTED: 'true',
        CI_PIPELINE_ID: '4242',
        CI_JOB_ID: '777',
        CI_JOB_TOKEN: 'job-token',
        DEPLOY_MARKER_SIGNING_KEY: KEY,
        DEPLOY_MARKER_PUSH_URL: remote,
        DEPLOY_SCOPE_PATHS_DIR: path.join(REPO_ROOT, 'ci', 'deploy-scope'),
        ...overrides,
    })
    const run = (args, overrides) => {
        const result = spawnSync('sh', [SCOPE_SCRIPT, ...args], { encoding: 'utf8', env: env(overrides) })
        return {
            status: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
            all: result.stdout + result.stderr,
        }
    }
    const record = (target, sha, overrides = {}) => run(['record', target], { CI_COMMIT_SHA: sha, ...overrides })
    const hasChanges = (target, sha, overrides = {}) =>
        run(['has-changes', target], { CI_COMMIT_SHA: sha, ...overrides })
    const markerRead = (target, sha, overrides = {}) =>
        run(['marker-read', target], { CI_COMMIT_SHA: sha, ...overrides })
    const remoteMarker = ref => {
        const line = git(work, 'ls-remote', remote, ref)
        return line ? line.split(/\s+/)[0] : ''
    }
    const forcePush = (source, ref) => git(work, 'push', '-q', '--force', remote, `${source}:${ref}`)
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
    return { dir, remote, work, git, commit, run, record, hasChanges, markerRead, remoteMarker, forcePush, cleanup }
}

describe('a signed production marker scopes the deploy', () => {
    let f
    beforeEach(() => {
        f = makeFixture()
    })
    afterEach(() => f.cleanup())

    it('writes an annotated tag carrying the signed fields', () => {
        const c0 = f.commit('firestore.rules', 'A')
        f.git(f.work, 'push', '-q', 'origin', 'master')
        expect(f.record(RULES, c0).status).toBe(0)

        f.git(f.work, 'fetch', '-q', 'origin', `+${RULES_REF}:${RULES_REF}`)
        expect(f.git(f.work, 'cat-file', '-t', RULES_REF)).toBe('tag')
        const body = f.git(f.work, 'cat-file', 'tag', RULES_REF)
        expect(body).toContain(`target=${RULES}`)
        expect(body).toContain(`commit=${c0}`)
        expect(body).toContain('ref=master')
        expect(body).toContain('pipeline=4242')
        expect(body).toMatch(/signature=hmac-sha256:[0-9a-f]{64}/)
        expect(body).not.toContain(KEY)
    })

    it('skips when nothing changed since the marker and deploys when something did', () => {
        const c0 = f.commit('firestore.rules', 'A')
        f.record(RULES, c0)
        expect(f.hasChanges(RULES, c0).status).toBe(NOT_NEEDED)

        const c1 = f.commit('components/View.js', 'ui only')
        expect(f.hasChanges(RULES, c1).status).toBe(NOT_NEEDED)

        const c2 = f.commit('firestore.rules', 'B')
        expect(f.hasChanges(RULES, c2).status).toBe(0)
    })

    it('still deploys a revert when an older genuine marker is replayed', () => {
        // Rules A deployed, then B deployed, then master reverts to A. Production runs B.
        // Replaying the first (validly signed) tag object makes the two trees equal, so a
        // plain tree diff would report "already deployed" and leave B live.
        const c0 = f.commit('firestore.rules', 'A')
        f.record(RULES, c0)
        const oldTagObject = f.remoteMarker(RULES_REF)
        const c1 = f.commit('firestore.rules', 'B')
        f.record(RULES, c1)
        const c2 = f.commit('firestore.rules', 'A')

        expect(f.hasChanges(RULES, c2).status).toBe(0)
        f.forcePush(oldTagObject, RULES_REF)
        expect(f.markerRead(RULES, c2).stdout.trim()).toBe(c0)
        const replayed = f.hasChanges(RULES, c2)
        expect(replayed.status).toBe(0)
        expect(replayed.all).toContain('firestore.rules')
    })
})

describe('a production marker that CI did not write is ignored, which means deploying', () => {
    let f
    beforeEach(() => {
        f = makeFixture()
    })
    afterEach(() => f.cleanup())

    it('ignores a lightweight tag (what a Developer push or a branch job token writes)', () => {
        f.commit('firestore.rules', 'A')
        const head = f.commit('README.md', 'docs')
        f.forcePush(head, RULES_REF)
        const result = f.hasChanges(RULES, head)
        expect(result.status).toBe(0)
        expect(result.all).toContain('not an annotated tag written by CI')
    })

    it('ignores an annotated tag with a forged signature', () => {
        const head = f.commit('firestore.rules', 'A')
        f.record(RULES, head, { DEPLOY_MARKER_SIGNING_KEY: 'attacker-guess' })
        const result = f.hasChanges(RULES, head)
        expect(result.status).toBe(0)
        expect(result.all).toContain('the signature does not verify')
    })

    it("ignores another target's genuine marker copied over this one", () => {
        const head = f.commit('firestore.rules', 'A')
        f.record('web-production', head)
        f.forcePush(f.remoteMarker('refs/tags/deployed/web-production'), RULES_REF)
        const result = f.hasChanges(RULES, head)
        expect(result.status).toBe(0)
        expect(result.all).toContain("signed for target 'web-production'")
    })

    it('ignores a signed marker on a commit outside the default branch history (e.g. the MR source commit)', () => {
        const base = f.commit('firestore.rules', 'old')
        f.git(f.work, 'checkout', '-q', '-b', 'fix')
        const mrSource = f.commit('firestore.rules', 'fixed')
        f.git(f.work, 'checkout', '-q', 'master')
        // The squash merge: same rules, different commit (a distinct message, or git would
        // produce the identical commit within the same second).
        const squash = f.commit('firestore.rules', 'fixed', 'squash merge of fix')
        expect(squash).not.toBe(mrSource)
        const head = f.commit('other.txt', 'unrelated')
        expect(base).toBeTruthy()
        f.record(RULES, mrSource)
        const result = f.hasChanges(RULES, head)
        expect(result.status).toBe(0)
        expect(result.all).toContain('not an ancestor of')
    })

    it('deploys when the marker is missing instead of falling back to the push range', () => {
        f.commit('firestore.rules', 'A')
        const head = f.commit('README.md', 'docs')
        const result = f.hasChanges(RULES, head, { CI_COMMIT_BEFORE_SHA: f.git(f.work, 'rev-parse', 'HEAD~1') })
        expect(result.status).toBe(0)
        expect(result.all).toContain('no verified')
    })

    it('computes a full plan, rather than crashing, when no production marker can be trusted', () => {
        // The first master pipeline after signing shipped finds only unsigned markers. The
        // Functions branch must still write its plan, because `compute` reads it next.
        f.commit('functions/index.js', 'exports.alpha = () => 1')
        const head = f.commit('components/View.js', 'ui')
        for (const target of ['web-production', 'functions-production', 'runner-production']) {
            f.forcePush(head, `refs/tags/deployed/${target}`)
        }
        const result = f.run(['compute'], { CI_COMMIT_SHA: head })
        expect(result.status).toBe(0)
        const scope = fs.readFileSync(path.join(f.work, 'deploy-scope.env'), 'utf8')
        expect(scope).toContain('DEPLOY_WEB_PRODUCTION=1')
        expect(scope).toContain('DEPLOY_FUNCTIONS_PRODUCTION=1')
        expect(scope).toContain('DEPLOY_FIRESTORE_RULES_PRODUCTION=1')
        const plan = JSON.parse(fs.readFileSync(path.join(f.work, 'functions-deploy-scope.json'), 'utf8'))
        expect(plan.mode).toBe('full')
    })

    it('refuses to sign from a branch pipeline, even one that has the key', () => {
        const head = f.commit('firestore.rules', 'A')
        const result = f.record(RULES, head, { CI_COMMIT_BRANCH: 'feature' })
        expect(result.status).toBe(0)
        expect(result.all).toContain('only signed by protected default-branch pipelines')
        expect(f.remoteMarker(RULES_REF)).toBe('')
    })

    it('fails loudly on the default branch when the signing key is missing', () => {
        const head = f.commit('firestore.rules', 'A')
        const result = f.hasChanges(RULES, head, { DEPLOY_MARKER_SIGNING_KEY: '' })
        expect(result.status).toBe(1)
        expect(result.all).toContain('DEPLOY_MARKER_SIGNING_KEY is not available')
    })
})

describe('marker plumbing', () => {
    let f
    beforeEach(() => {
        f = makeFixture()
    })
    afterEach(() => f.cleanup())

    it('takes the staging markers that feature-branch pipelines write as they are', () => {
        const head = f.commit('functions/index.js', 'exports.a = 1')
        f.forcePush(head, 'refs/tags/deployed/functions-staging')
        expect(f.markerRead('functions-staging', head, { DEPLOY_MARKER_SIGNING_KEY: '' }).stdout.trim()).toBe(head)
    })

    it('marker-read prints only the commit on stdout, its reasons on stderr', () => {
        const head = f.commit('firestore.rules', 'A')
        f.forcePush(head, 'refs/tags/deployed/github-mirror')
        const rejected = f.markerRead('github-mirror', head)
        expect(rejected.stdout).toBe('')
        expect(rejected.stderr).toContain('IGNORING marker')

        f.record('github-mirror', head)
        const accepted = f.markerRead('github-mirror', head)
        expect(accepted.stdout.trim()).toBe(head)
    })

    it('does not turn a complete clone shallow when reading a marker (the mirror needs its cutoff)', () => {
        const first = f.commit('a.txt', '1')
        const head = f.commit('a.txt', '2')
        f.record('github-mirror', head)
        f.markerRead('github-mirror', head)
        expect(f.git(f.work, 'rev-parse', '--is-shallow-repository')).toBe('false')
        expect(f.git(f.work, 'merge-base', '--is-ancestor', first, head)).toBe('')
    })

    it('deepens a shallow CI clone until it can prove the marker is an ancestor', () => {
        const c0 = f.commit('firestore.rules', 'A')
        f.git(f.work, 'push', '-q', 'origin', 'master')
        f.record(RULES, c0)
        for (let i = 0; i < 60; i++) f.commit('notes.txt', `line ${i}`)
        f.git(f.work, 'push', '-q', 'origin', 'master')
        const head = f.git(f.work, 'rev-parse', 'HEAD')

        const shallow = path.join(f.dir, 'shallow')
        execFileSync('git', ['clone', '-q', '--depth', '50', '--branch', 'master', `file://${f.remote}`, shallow])
        expect(f.git(shallow, 'rev-parse', '--is-shallow-repository')).toBe('true')
        const result = f.hasChanges(RULES, head, { CI_PROJECT_DIR: shallow })
        expect(result.all).toContain(`changed since marker base ${c0}`)
        expect(result.status).toBe(NOT_NEEDED)
    })

    const tools = ['node', 'python3', 'openssl'].filter(hasTool)
    it.each(tools)('signs with %s exactly as every other image verifies', tool => {
        const head = f.commit('firestore.rules', 'A')
        expect(f.record(RULES, head, { DEPLOY_MARKER_HMAC_TOOL: tool }).status).toBe(0)
        for (const verifier of tools) {
            expect(f.markerRead(RULES, head, { DEPLOY_MARKER_HMAC_TOOL: verifier }).stdout.trim()).toBe(head)
        }
    })
})

describe('the GitHub mirror cannot be steered into publishing withheld history', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'ci', 'github-push.sh'), 'utf8')
    const guardStart = source.indexOf('if [ -n "$LAST_MIRRORED" ]')
    const incrementalGuard = source.slice(guardStart, source.indexOf('; then\n', guardStart))

    it('only appends when the last mirrored commit is not older than the cutoff', () => {
        expect(source).toContain('git merge-base --is-ancestor "$CUTOFF_COMMIT" "$LAST_MIRRORED"')
        expect(incrementalGuard).toContain('"$CUTOFF_COMMIT" "$LAST_MIRRORED"')
    })

    it('only appends onto a mirror tip that really is the replay of that commit', () => {
        expect(incrementalGuard).toContain('"${MIRROR_TIP}^{tree}"')
        expect(incrementalGuard).toContain('"${LAST_MIRRORED}^{tree}"')
    })

    it('reads the marker through the verifying marker-read', () => {
        expect(source).toContain('deployScope.sh" marker-read "$MIRROR_MARKER"')
    })
})
