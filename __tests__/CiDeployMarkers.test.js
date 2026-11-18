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

// Git runs `git maintenance run --auto --detach` after every commit and fetch (and a push into the
// bare remote runs `gc --auto` there): background repacks that went on writing into the fixture's
// repositories while the test moved on. On CI that failed a commit with "could not parse HEAD" and
// the cleanup with ENOTEMPTY (2026-11-16, twice). Every git here, the script's included, runs
// without them.
const NO_BACKGROUND_GIT = {
    GIT_CONFIG_COUNT: '4',
    GIT_CONFIG_KEY_0: 'maintenance.auto',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'gc.auto',
    GIT_CONFIG_VALUE_1: '0',
    GIT_CONFIG_KEY_2: 'receive.autogc',
    GIT_CONFIG_VALUE_2: 'false',
    GIT_CONFIG_KEY_3: 'maintenance.autoDetach',
    GIT_CONFIG_VALUE_3: 'false',
}
const GIT_ENV = { ...process.env, ...NO_BACKGROUND_GIT }

function makeFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-markers-'))
    const remote = path.join(dir, 'remote.git')
    const work = path.join(dir, 'work')
    const git = (cwd, ...args) =>
        execFileSync('git', ['-C', cwd, ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: GIT_ENV,
        }).trim()
    git(dir, 'init', '-q', '--bare', remote)
    // A push hands the bare remote's receive-pack a clean environment (no GIT_CONFIG_*), so the remote
    // keeps the same settings in its own config.
    for (let i = 0; i < Number(NO_BACKGROUND_GIT.GIT_CONFIG_COUNT); i++) {
        git(remote, 'config', NO_BACKGROUND_GIT[`GIT_CONFIG_KEY_${i}`], NO_BACKGROUND_GIT[`GIT_CONFIG_VALUE_${i}`])
    }
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
        ...NO_BACKGROUND_GIT,
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
    const AUTHOR = [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'core.hooksPath=/dev/null',
    ]
    // A merge request: `branch` into the checked-out branch, always with a merge commit.
    // `edit` writes files into the merge itself, as a conflict resolution does.
    const merge = (branch, edit) => {
        git(work, ...AUTHOR, 'merge', '-q', '--no-ff', '--no-commit', branch)
        if (edit) {
            edit()
            git(work, 'add', '-A')
        }
        git(work, ...AUTHOR, 'commit', '-qm', `Merge branch '${branch}'`)
        return git(work, 'rev-parse', 'HEAD')
    }
    // What a GitLab job starts from: a clone that ends `depth` commits behind the tip.
    const shallowClone = depth => {
        const clone = path.join(dir, `shallow-${depth}`)
        execFileSync(
            'git',
            ['clone', '-q', '--depth', String(depth), '--branch', 'master', `file://${remote}`, clone],
            {
                env: GIT_ENV,
            }
        )
        return clone
    }
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
    return {
        dir,
        remote,
        work,
        git,
        commit,
        merge,
        shallowClone,
        run,
        record,
        hasChanges,
        markerRead,
        remoteMarker,
        forcePush,
        cleanup,
    }
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
        execFileSync('git', ['clone', '-q', '--depth', '50', '--branch', 'master', `file://${f.remote}`, shallow], {
            env: GIT_ENV,
        })
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

// The range behind a marker has to hold what shipped SINCE it and nothing else. Two ways it
// used to hold far more made merge requests redeploy targets they had not touched: in eight
// days of 2026-11, all 303 Functions twice (pipelines 9705 and 9808, both web-only merges)
// and the runner image 13 times without a functions/ change.
describe('merging a branch does not make work that already shipped look new', () => {
    let f
    beforeEach(() => {
        f = makeFixture()
    })
    afterEach(() => f.cleanup())

    // master: ... fork ... rulesB (deployed, marker) - merge
    //               \                                 /
    //                feature (touches components/ only)
    const mergeAfterDeploy = ({ before = 0, between = 0 } = {}) => {
        f.commit('firestore.rules', 'A')
        for (let i = 0; i < before; i++) f.commit('notes.txt', `before ${i}`)
        const fork = f.git(f.work, 'rev-parse', 'HEAD')
        f.git(f.work, 'checkout', '-q', '-b', 'feature')
        f.commit('components/Feature.js', 'ui only')
        f.git(f.work, 'checkout', '-q', 'master')
        for (let i = 0; i < between; i++) f.commit('notes.txt', `between ${i}`)
        const deployed = f.commit('firestore.rules', 'B')
        f.git(f.work, 'push', '-q', 'origin', 'master')
        f.record(RULES, deployed)
        return { fork, deployed }
    }

    it('does not count what master changed before the marker when a merge brings in an older branch', () => {
        // The merge differs from its second parent (the branch) by everything master did
        // since the branch forked, here the rules change that the marker already covers.
        mergeAfterDeploy()
        const head = f.merge('feature')
        const result = f.hasChanges(RULES, head)
        expect(result.all).not.toContain('firestore.rules')
        expect(result.status).toBe(NOT_NEEDED)
    })

    it('still counts what a merge commit itself wrote, even when a later commit takes it back', () => {
        const { deployed } = mergeAfterDeploy()
        f.merge('feature', () => fs.writeFileSync(path.join(f.work, 'firestore.rules'), 'written in the merge'))
        const head = f.commit('firestore.rules', 'B', 'back to the deployed rules')
        expect(f.git(f.work, 'diff', '--name-only', deployed, head)).not.toContain('firestore.rules')
        const result = f.hasChanges(RULES, head)
        expect(result.status).toBe(0)
        expect(result.all).toContain('firestore.rules')
    })

    it('keeps the history behind a marker that is already inside the shallow clone', () => {
        // The clone holds the marker with its parents. A depth-1 fetch of the marker cut it
        // off from them, so the fork point and everything older were no longer "before the
        // marker", and the commit the clone ends on lists every file in the repository.
        const { deployed } = mergeAfterDeploy({ before: 10 })
        const head = f.merge('feature')
        f.git(f.work, 'push', '-q', 'origin', 'master')

        const shallow = f.shallowClone(5)
        expect(f.git(shallow, 'rev-parse', '--is-shallow-repository')).toBe('true')
        expect(f.git(shallow, 'rev-list', '--count', `${deployed}..${head}`)).toBe('2')

        const result = f.hasChanges(RULES, head, { CI_PROJECT_DIR: shallow })
        expect(result.all).not.toContain('firestore.rules')
        expect(result.status).toBe(NOT_NEEDED)
        expect(f.git(shallow, 'rev-list', '--count', `${deployed}..${head}`)).toBe('2')
        expect(fs.readFileSync(path.join(shallow, '.git', 'shallow'), 'utf8')).not.toContain(deployed)
    })

    it('reads a second marker without cutting or deepening the clone', () => {
        // `compute` verifies one marker per target in the same checkout. A newer marker
        // grafted in front of an older one hid the older marker from the commit under
        // test, and proving it an ancestor again cost a 1,000-commit fetch per target.
        const { deployed } = mergeAfterDeploy({ before: 10 })
        const webDeployed = f.commit('components/View.js', 'shipped later')
        const head = f.commit('README.md', 'docs')
        f.git(f.work, 'push', '-q', 'origin', 'master')
        f.record('web-production', webDeployed)

        const shallow = f.shallowClone(5)
        const commitsHeld = f.git(shallow, 'rev-list', '--count', head)
        expect(f.hasChanges('web-production', head, { CI_PROJECT_DIR: shallow }).status).toBe(NOT_NEEDED)
        const result = f.hasChanges(RULES, head, { CI_PROJECT_DIR: shallow })
        expect(result.all).not.toContain('firestore.rules')
        expect(result.status).toBe(NOT_NEEDED)
        expect(f.git(shallow, 'rev-list', '--count', `${deployed}..${head}`)).toBe('2')
        expect(f.git(shallow, 'rev-list', '--count', head)).toBe(commitsHeld)
    })

    it('deepens the clone when a merged branch forked before the point where the clone ends', () => {
        // The branch reaches its fork point in two steps; master needs more than the clone
        // holds. From the marker the fork point is out of reach, so without more history it
        // and the commits behind it count as changes.
        const { fork, deployed } = mergeAfterDeploy({ before: 3, between: 8 })
        const head = f.merge('feature')
        f.git(f.work, 'push', '-q', 'origin', 'master')

        const shallow = f.shallowClone(5)
        expect(f.git(shallow, 'rev-list', `${deployed}..${head}`)).toContain(fork)

        const result = f.hasChanges(RULES, head, { CI_PROJECT_DIR: shallow })
        expect(result.all).not.toContain('firestore.rules')
        expect(result.status).toBe(NOT_NEEDED)
        expect(f.git(shallow, 'rev-list', '--count', `${deployed}..${head}`)).toBe('2')
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
