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

    it('covers the three known production deploy jobs', () => {
        expect(
            productionDeployJobs()
                .map(([name]) => name)
                .sort()
        ).toEqual(['deploy:cloud:functions:production', 'deploy:cloud:runner:production', 'deploy:web'])
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
    it('declares the superseded exit code as an allowed failure', () => {
        for (const [name, job] of productionDeployJobs()) {
            if (EXEMPT_JOBS[name]) continue
            const exitCodes = [].concat((job.allow_failure && job.allow_failure.exit_codes) || [])
            expect(`${name}:${exitCodes.join(',')}`).toBe(`${name}:${SUPERSEDED_EXIT_CODE}`)
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
