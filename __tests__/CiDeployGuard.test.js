const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const yaml = require('js-yaml')

const REPO_ROOT = path.join(__dirname, '..')
const GUARD_SCRIPT = path.join(REPO_ROOT, 'ci', 'assertNewestCommit.sh')
const CI_CONFIG = yaml.load(fs.readFileSync(path.join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8'))

const SUPERSEDED_EXIT_CODE = 75

// A job "deploys" if it runs one of these. Read-only checks and endpoint pings do not count.
const DEPLOY_COMMAND = /firebase deploy|deploy\.sh/
const RUNS_ON_DEFAULT_BRANCH = /==\s*\$CI_DEFAULT_BRANCH/

/**
 * Production deploy jobs that legitimately need no newest-commit guard, with the reason.
 * Anything else that deploys on the default branch must carry the guard — that is the
 * property this file exists to hold, so a future deploy job cannot quietly skip it.
 */
const EXEMPT_JOBS = {
    'check:firestore:indexes:production': 'read-only drift report; deploys nothing',
    'update:version:production':
        'pings a version-bump endpoint rather than deploying source; replaying it from an older pipeline is idempotent',
}

// This authorization cutover is deliberately operator-approved and optional so it
// cannot hold unrelated production releases. Its manual rule therefore allows all
// outcomes; the newest-commit guard still prevents a stale ruleset from being published.
const OPTIONAL_MANUAL_DEPLOY_JOBS = new Set(['deploy:firestore:rules:production'])

const jobEntries = () =>
    Object.entries(CI_CONFIG).filter(
        ([name, job]) => job && typeof job === 'object' && !name.startsWith('.') && Array.isArray(job.script)
    )

const rulesText = job => JSON.stringify(job.rules || [])

const productionDeployJobs = () =>
    jobEntries().filter(
        ([, job]) => RUNS_ON_DEFAULT_BRANCH.test(rulesText(job)) && job.script.some(line => DEPLOY_COMMAND.test(line))
    )

const runGuard = (env, { fakeGitSha, fakeGitFails } = {}) => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-bin-'))
    if (fakeGitSha || fakeGitFails) {
        // `git ls-remote origin refs/heads/<branch>` is the guard's primary probe.
        const script = fakeGitFails
            ? '#!/bin/sh\nexit 128\n'
            : `#!/bin/sh\nif [ "$1" = "ls-remote" ]; then echo "${fakeGitSha}\trefs/heads/master"; fi\n`
        fs.writeFileSync(path.join(binDir, 'git'), script)
        fs.chmodSync(path.join(binDir, 'git'), 0o755)
    }

    try {
        const stdout = execFileSync('sh', [GUARD_SCRIPT, 'test-job'], {
            encoding: 'utf8',
            env: { PATH: `${binDir}:${process.env.PATH}`, ...env },
        })
        return { code: 0, stdout }
    } catch (error) {
        return { code: error.status, stdout: String(error.stdout || '') + String(error.stderr || '') }
    } finally {
        fs.rmSync(binDir, { recursive: true, force: true })
    }
}

const NEWEST = 'a'.repeat(40)
const OLDER = 'b'.repeat(40)

// No API fallback configured, so the fake git is the only probe the guard can use.
const baseEnv = { CI_COMMIT_BRANCH: 'master', CI_COMMIT_SHA: OLDER }

describe('production deploy jobs are protected against out-of-order pipelines', () => {
    // The 2026-08-10 incident: a stale master pipeline ran `firebase deploy --only functions
    // --force` after a newer one, deleting two just-shipped callables and reverting a third.
    // `interruptible: false` keeps a superseded deploy job alive and `resource_group` only
    // serializes, so nothing else in this pipeline enforces an order.
    it('guards every job that deploys on the default branch', () => {
        const unguarded = productionDeployJobs()
            .filter(([name]) => !EXEMPT_JOBS[name])
            .filter(([, job]) => !job.script.some(line => line.includes('ci/assertNewestCommit.sh')))
            .map(([name]) => name)

        expect(unguarded).toEqual([])
    })

    // A ratchet, not a description: a NEW production deploy job has to be added here
    // deliberately, which is the moment to check it carries the guard, the exit code, the
    // resource group and `interruptible: false` that the other cases in this file assert.
    it('covers the four known production deploy jobs', () => {
        expect(
            productionDeployJobs()
                .map(([name]) => name)
                .sort()
        ).toEqual([
            'deploy:cloud:functions:production',
            'deploy:cloud:runner:production',
            'deploy:firestore:rules:production',
            'deploy:web',
        ])
    })

    it('runs the guard before the deploy command in each guarded job', () => {
        for (const [name, job] of productionDeployJobs()) {
            if (EXEMPT_JOBS[name]) continue
            const guardIndex = job.script.findIndex(line => line.includes('ci/assertNewestCommit.sh'))
            const deployIndex = job.script.findIndex(line => DEPLOY_COMMAND.test(line))
            expect(`${name}:${guardIndex < deployIndex}`).toBe(`${name}:true`)
        }
    })

    // Without this, a superseded pipeline turns red for doing exactly the right thing.
    // Deploy jobs also carry 76 ("this target is already up to date", see ci/deployScope.sh),
    // so assert 75 is present rather than that it is the only allowed code — but keep
    // asserting that a plain `allow_failure: true` is never used, which would swallow a
    // genuine deploy failure.
    it('declares the superseded exit code as an allowed failure', () => {
        for (const [name, job] of productionDeployJobs()) {
            if (EXEMPT_JOBS[name]) continue
            if (OPTIONAL_MANUAL_DEPLOY_JOBS.has(name)) continue
            const exitCodes = [].concat((job.allow_failure && job.allow_failure.exit_codes) || [])
            expect(`${name}:${exitCodes.includes(SUPERSEDED_EXIT_CODE)}`).toBe(`${name}:true`)
            expect(`${name}:${job.allow_failure === true}`).toBe(`${name}:false`)
        }
    })

    it('keeps authorization cutovers explicitly manual and optional', () => {
        for (const name of OPTIONAL_MANUAL_DEPLOY_JOBS) {
            const job = CI_CONFIG[name]
            const productionRule = job.rules.find(rule => RUNS_ON_DEFAULT_BRANCH.test(JSON.stringify(rule.if || '')))

            expect(productionRule).toMatchObject({ when: 'manual', allow_failure: true })
        }
    })

    // A guarded deploy must still be non-interruptible; otherwise a newer commit cancels a
    // deploy that is already writing to production.
    it('keeps guarded deploys serialized and non-interruptible', () => {
        for (const [name, job] of productionDeployJobs()) {
            if (EXEMPT_JOBS[name]) continue
            expect(`${name}:${job.interruptible}`).toBe(`${name}:false`)
            expect(`${name}:${Boolean(job.resource_group)}`).toBe(`${name}:true`)
        }
    })
})

// Every job that runs the guard must be able to run its PRIMARY probe, `git ls-remote`.
// The guard's GitLab API fallback is not a substitute: CI_JOB_TOKEN is only accepted on a
// small allowlist of endpoints and `/repository/branches/:branch` is not among them, so the
// probe 401s and the guard fails CLOSED with exit 1 — which is deliberately NOT in
// allow_failure. `update:version:production` shipped on `curlimages/curl` (no git, and a
// non-root user so it cannot install any) and failed on every master push, leaving clients
// on a stale bundle because nothing bumped the app version.
describe('every guarded job can actually run the guard', () => {
    // Images known to ship git, so they need no install line.
    const IMAGES_WITH_GIT = [/build_functions/, /build_web_bundler/, /build_base/, /alpine\/git/]

    const guardedJobs = () => jobEntries().filter(([, job]) => job.script.some(l => l.includes('assertNewestCommit')))

    const makesGitAvailable = job => {
        const image = typeof job.image === 'string' ? job.image : (job.image && job.image.name) || ''
        if (IMAGES_WITH_GIT.some(re => re.test(image))) return true
        const lines = [].concat(job.before_script || [], job.script || []).join('\n')
        // Either an unconditional install, or the `command -v git || install` fallback.
        return /apk add[^\n]*\bgit\b|apt-get install[^\n]*\bgit\b/.test(lines)
    }

    it('finds the guarded jobs at all, so this test cannot pass vacuously', () => {
        expect(guardedJobs().length).toBeGreaterThan(0)
    })

    it('gives git to every job that runs the guard', () => {
        const withoutGit = guardedJobs()
            .filter(([, job]) => !makesGitAvailable(job))
            .map(([name]) => name)

        expect(withoutGit).toEqual([])
    })
})

describe('ci/assertNewestCommit.sh', () => {
    it('allows the deploy when the commit is the branch tip', () => {
        const result = runGuard({ ...baseEnv, CI_COMMIT_SHA: NEWEST }, { fakeGitSha: NEWEST })

        expect(result.code).toBe(0)
        expect(result.stdout).toContain('current tip')
    })

    it('reports superseded with exit 75 when the branch has moved on', () => {
        const result = runGuard(baseEnv, { fakeGitSha: NEWEST })

        expect(result.code).toBe(SUPERSEDED_EXIT_CODE)
        expect(result.stdout).toContain('SUPERSEDED')
    })

    // Fail closed: a skipped deploy is fixed with a retry, an out-of-order one reverts production.
    it('fails hard when the branch tip cannot be determined', () => {
        const result = runGuard(baseEnv, { fakeGitFails: true })

        expect(result.code).toBe(1)
        expect(result.stdout).toContain('Refusing to deploy')
    })

    it('fails hard outside a branch pipeline instead of assuming it is current', () => {
        const result = runGuard({ CI_COMMIT_SHA: OLDER }, { fakeGitSha: NEWEST })

        expect(result.code).toBe(1)
    })

    it('lets an operator force a deliberate rollback through', () => {
        const result = runGuard({ ...baseEnv, ALLOW_STALE_DEPLOY: '1' }, { fakeGitSha: NEWEST })

        expect(result.code).toBe(0)
        expect(result.stdout).toContain('on purpose')
    })
})
