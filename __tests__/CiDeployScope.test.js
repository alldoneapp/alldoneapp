const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const yaml = require('js-yaml')

const REPO_ROOT = path.join(__dirname, '..')
const SCOPE_SCRIPT = path.join(REPO_ROOT, 'ci', 'deployScope.sh')
const CI_CONFIG = yaml.load(fs.readFileSync(path.join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8'))

const NOT_NEEDED_EXIT_CODE = 76
const SUPERSEDED_EXIT_CODE = 75

// Deploy targets whose scope is decided by the marker rather than by `rules: changes:`.
// Each entry is the job that ships it and the target name it must use.
const MARKER_SCOPED_JOBS = {
    'deploy:web': 'web-production',
    'deploy:cloud:functions:production': 'functions-production',
    'deploy:cloud:runner:production': 'runner-production',
}

const job = name => CI_CONFIG[name]
const allLines = j => [].concat(j.before_script || [], j.script || []).join('\n')
const rulesText = j => JSON.stringify(j.rules || [])

describe('production deploys are scoped by what shipped, not by what this push touched', () => {
    // The hole this closes: `rules: changes:` asks "did THIS push touch functions/", while
    // ci/assertNewestCommit.sh makes a superseded pipeline skip its deploy. Push A (functions
    // only) is superseded by push B (web only); B's pipeline never contained a functions
    // deploy job, so A's change ships from nowhere and both pipelines stay green.
    it.each(Object.entries(MARKER_SCOPED_JOBS))(
        '%s is not scoped by rules:changes, so it can catch up a skipped deploy',
        (name, _target) => {
            expect(rulesText(job(name))).not.toContain('changes')
        }
    )

    it.each(Object.entries(MARKER_SCOPED_JOBS))('%s asks the marker whether it must run', (name, target) => {
        expect(allLines(job(name))).toContain(`deployScope.sh require ${target}`)
    })

    it.each(Object.entries(MARKER_SCOPED_JOBS))('%s records the marker after deploying', (name, target) => {
        const lines = [].concat(job(name).before_script || [], job(name).script || [])
        const recordIndex = lines.findIndex(l => l.includes(`deployScope.sh record ${target}`))
        expect(recordIndex).toBeGreaterThanOrEqual(0)

        // Recording before the deploy would mark work as shipped that never shipped, and the
        // next pipeline would then skip it forever.
        const deployIndex = lines.findIndex(l => /firebase deploy|deploy\.sh/.test(l))
        expect(deployIndex).toBeGreaterThanOrEqual(0)
        expect(recordIndex).toBeGreaterThan(deployIndex)
    })

    it.each(Object.entries(MARKER_SCOPED_JOBS))('%s allows both the skip and superseded codes', name => {
        const codes = (job(name).allow_failure || {}).exit_codes || []
        expect(codes).toEqual(expect.arrayContaining([SUPERSEDED_EXIT_CODE, NOT_NEEDED_EXIT_CODE]))
    })

    it('computes the scope exactly once and hands it to every consumer', () => {
        expect(job('deploy_scope')).toBeDefined()
        expect(allLines(job('deploy_scope'))).toContain('deployScope.sh compute')
        expect(job('deploy_scope').artifacts.paths).toContain('deploy-scope.env')

        // A `needs` list replaces the default "artifacts from all earlier stages", so a job
        // with explicit needs must ask for the scope artifact or it silently loses it and
        // falls back to deploying unconditionally.
        for (const [name] of Object.entries(MARKER_SCOPED_JOBS)) {
            const needs = job(name).needs
            if (needs) expect(needs).toContain('deploy_scope')
        }
    })

    it('gates the build and its tests on the same answer as the deploy', () => {
        // Both feed deploy:web through `needs`, so if they were still scoped by `changes:`
        // they would be absent from exactly the pipeline that has to catch up a skipped
        // web deploy, and `needs` would be unresolvable.
        for (const name of ['build_web_production', 'test:web:full']) {
            expect(allLines(job(name))).toContain('deployScope.sh require web-production')
            // Only 76 is allowed: a real build or test failure is any other non-zero code
            // and must still block deploy:web. A bare `allow_failure: true` would not.
            const codes = [].concat((job(name).allow_failure || {}).exit_codes || [])
            expect(`${name}:${codes.join(',')}`).toBe(`${name}:${NOT_NEEDED_EXIT_CODE}`)
            expect(job(name).allow_failure).not.toBe(true)
        }
    })

    it('does not ask users to reload for a bundle that was never deployed', () => {
        // update:version:production makes clients reload. It used to run on every master
        // push, including ones that deployed nothing.
        const lines = allLines(job('update:version:production'))
        expect(lines).toContain('deployScope.sh require web-production')
        expect(lines).toContain('assertNewestCommit.sh')
    })
})

describe('the GitHub mirror is its own job', () => {
    it('no longer forces the production build to be non-interruptible', () => {
        // Mirroring inside build_web_production gave that ~9-minute build an external side
        // effect, so it could not be auto-cancelled and every superseded master push paid
        // for it in full.
        expect(allLines(job('build_web_production'))).not.toContain('github-push.sh')
        expect(job('build_web_production').interruptible).not.toBe(false)
    })

    it('runs on every default-branch push, is serialized, and cannot run out of order', () => {
        const mirror = job('mirror:github')
        expect(mirror).toBeDefined()
        expect(allLines(mirror)).toContain('ci/github-push.sh')
        // Scoping the mirror to web paths meant a functions-only push never reached GitHub.
        expect(rulesText(mirror)).not.toContain('changes')
        expect(mirror.interruptible).toBe(false)
        expect(mirror.resource_group).toBeTruthy()
        expect(allLines(mirror)).toContain('assertNewestCommit.sh')
        expect((mirror.allow_failure || {}).exit_codes).toEqual(SUPERSEDED_EXIT_CODE)
        // Pushing real history to a repository that already has it needs a full clone.
        expect(String(mirror.variables.GIT_DEPTH)).toBe('0')
    })
})

describe('the web path list has exactly one meaning', () => {
    // ci/deploy-scope/web-production.paths drives the marker comparison; the
    // *web-relevant-paths anchor still drives the feature-branch jobs. If they drift, a
    // production deploy and a branch check disagree about what "web-relevant" means.
    const escapeRegex = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

    const globToRegex = glob => {
        if (glob.endsWith('/**/*')) return `^${escapeRegex(glob.slice(0, -4))}`
        return `^${escapeRegex(glob).replace(/\*/g, '[^/]*')}$`
    }

    it('matches the *web-relevant-paths anchor in .gitlab-ci.yml', () => {
        const anchorPaths = CI_CONFIG['.web-relevant-changes'].rules[0].changes
        const expected = anchorPaths.map(globToRegex).sort()

        const fileContent = fs.readFileSync(path.join(REPO_ROOT, 'ci', 'deploy-scope', 'web-production.paths'), 'utf8')
        const actual = fileContent
            .split('\n')
            .map(l => l.replace(/#.*/, '').trim())
            .filter(Boolean)
            .sort()

        expect(actual).toEqual(expected)
    })

    it.each(['web-production', 'functions-production', 'runner-production'])(
        '%s.paths has no blank or comment-only pattern',
        target => {
            // A blank line in a `grep -f` pattern file matches EVERY path, which would mark
            // every deploy as needed - the failure would look like "it just always deploys".
            const raw = fs.readFileSync(path.join(REPO_ROOT, 'ci', 'deploy-scope', `${target}.paths`), 'utf8')
            const compiled = raw
                .split('\n')
                .map(l => l.replace(/#.*/, '').trim())
                .filter(Boolean)
            expect(compiled.length).toBeGreaterThan(0)
            compiled.forEach(pattern => expect(pattern).not.toBe(''))
        }
    )
})

describe('deployScope.sh require', () => {
    const runRequire = (target, scopeContents) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-'))
        const scopeFile = path.join(dir, 'deploy-scope.env')
        if (scopeContents !== null) fs.writeFileSync(scopeFile, scopeContents)

        try {
            execFileSync('sh', [SCOPE_SCRIPT, 'require', target], {
                encoding: 'utf8',
                env: {
                    PATH: process.env.PATH,
                    CI_PROJECT_DIR: REPO_ROOT,
                    DEPLOY_SCOPE_FILE: scopeFile,
                },
            })
            return 0
        } catch (error) {
            return error.status
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    }

    it('proceeds when the target is flagged for deploy', () => {
        expect(runRequire('web-production', 'DEPLOY_WEB_PRODUCTION=1\n')).toBe(0)
    })

    it('skips with 76 when the target is already up to date', () => {
        expect(runRequire('web-production', 'DEPLOY_WEB_PRODUCTION=0\n')).toBe(NOT_NEEDED_EXIT_CODE)
    })

    it('reads the entry for its own target only', () => {
        const scope = 'DEPLOY_WEB_PRODUCTION=0\nDEPLOY_FUNCTIONS_PRODUCTION=1\n'
        expect(runRequire('functions-production', scope)).toBe(0)
        expect(runRequire('web-production', scope)).toBe(NOT_NEEDED_EXIT_CODE)
    })

    it('fails safe toward deploying when the scope artifact is missing', () => {
        // Never skip on missing information: a redundant deploy is visible and cheap, a
        // silently skipped one ships nothing.
        expect(runRequire('web-production', null)).toBe(0)
    })

    it('fails safe toward deploying when the target has no entry', () => {
        expect(runRequire('runner-production', 'DEPLOY_WEB_PRODUCTION=1\n')).toBe(0)
    })
})
