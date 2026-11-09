// Branch pipelines must never write the images master runs in (security audit 2026-11, NV-31).
//
// A dependency-changing branch builds its own build_base / build_web_bundler images, and
// master's production build and gates run in `:latest`. The branch tag used to be the bare
// $CI_COMMIT_REF_SLUG, so a branch called `latest` (or `LATEST`, `latest_`: GitLab slugs
// all of them to `latest`) overwrote master's images with its own node_modules.
const fs = require('fs')
const path = require('path')

const yaml = require('js-yaml')

const CI_CONFIG = yaml.load(fs.readFileSync(path.join(__dirname, '..', '.gitlab-ci.yml'), 'utf8'))

const jobs = () =>
    Object.entries(CI_CONFIG).filter(([name, job]) => job && typeof job === 'object' && !name.startsWith('.'))
const DEFAULT_OR_DEVELOP =
    /^\$CI_COMMIT_BRANCH == "develop" \|\| \$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH$|^\$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH$/

describe('branch-scoped CI images', () => {
    const ruleTags = jobs().flatMap(([name, job]) =>
        (job.rules || [])
            .filter(rule => rule.variables && 'APP_IMAGE_TAG' in rule.variables)
            .map(rule => [name, String(rule.variables.APP_IMAGE_TAG), String(rule.if || '')])
    )

    it('finds the rules that pick a branch image', () => {
        expect(ruleTags.length).toBeGreaterThanOrEqual(6)
    })

    it.each(ruleTags)('%s tags a branch image with a prefix that can never be `latest`', (_name, tag, condition) => {
        expect(tag).toBe('branch-$CI_COMMIT_REF_SLUG')
        // Only branch rules may pick a branch image.
        expect(condition).toContain('$CI_COMMIT_BRANCH != $CI_DEFAULT_BRANCH')
        expect(condition).toContain('$CI_COMMIT_BRANCH != "develop"')
    })

    it('keeps `latest` as the job-level default everywhere a rule can override it', () => {
        for (const [name, job] of jobs()) {
            if (!(job.rules || []).some(rule => rule.variables && 'APP_IMAGE_TAG' in rule.variables)) continue
            expect(`${name}: ${(job.variables || {}).APP_IMAGE_TAG}`).toBe(`${name}: latest`)
        }
    })

    it('pushes a literal :latest image only from develop or the default branch', () => {
        for (const [name, job] of jobs()) {
            const script = [].concat(job.script || []).join('\n')
            if (!/--destination \S+:latest\b/.test(script)) continue
            for (const rule of job.rules || []) {
                expect(`${name}: ${DEFAULT_OR_DEVELOP.test(String(rule.if || ''))}`).toBe(`${name}: true`)
            }
        }
    })
})
