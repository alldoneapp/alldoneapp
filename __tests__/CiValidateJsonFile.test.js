const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const yaml = require('js-yaml')

const REPO_ROOT = path.join(__dirname, '..')
const SCRIPT = path.join(REPO_ROOT, 'ci', 'validateJsonFile.sh')
const CI_CONFIG = yaml.load(fs.readFileSync(path.join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8'))

const SECRET = 'sk-very-secret-value-0123456789'
const NO_BUNDLED = '/nonexistent/bundledpythonunix/bin/python3'

const which = name => {
    const result = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' })
    return result.status === 0 ? result.stdout.trim() : null
}

const REAL_PYTHON = which('python3')
const REAL_NODE = process.execPath
const describeWithPython = REAL_PYTHON ? describe : describe.skip

let tmp
let file

// A PATH holding only the tools the script needs plus the interpreters a test allows,
// so "the image has no python3" is reproduced exactly rather than assumed.
const makePath = ({ python = false, node = false } = {}) => {
    const bin = fs.mkdtempSync(path.join(tmp, 'bin-'))
    for (const tool of ['wc', 'tr']) fs.symlinkSync(which(tool), path.join(bin, tool))
    if (python) fs.symlinkSync(REAL_PYTHON, path.join(bin, 'python3'))
    if (node) fs.symlinkSync(REAL_NODE, path.join(bin, 'node'))
    return bin
}

const run = (content, { python, node, bundled = NO_BUNDLED, cloudsdkPython } = {}) => {
    if (content !== undefined) fs.writeFileSync(file, content)
    const env = { PATH: makePath({ python, node }), VALIDATE_JSON_BUNDLED_PYTHON: bundled }
    if (cloudsdkPython) env.CLOUDSDK_PYTHON = cloudsdkPython
    const result = spawnSync('/bin/sh', [SCRIPT, file, 'GOOGLE_FUNCTIONS_ENV_PROD'], { env, encoding: 'utf8' })
    return { status: result.status, out: result.stdout, err: result.stderr }
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-json-'))
    file = path.join(tmp, 'env_functions.json')
})

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describeWithPython('with Python', () => {
    it('accepts a JSON object and reports only its key count', () => {
        const result = run(JSON.stringify({ A: SECRET, B: 'x' }) + '\n', { python: true })
        expect(result.status).toBe(0)
        expect(result.out).toMatch(/2 top-level key/)
        expect(result.out + result.err).not.toContain(SECRET)
    })

    it('rejects malformed JSON with its position and without the content', () => {
        const result = run(`{"A": "${SECRET}" "B": 1}\n`, { python: true })
        expect(result.status).toBe(1)
        expect(result.err).toMatch(/line 1 column \d+/)
        expect(result.err).toContain('GOOGLE_FUNCTIONS_ENV_PROD')
        expect(result.out + result.err).not.toContain(SECRET)
    })

    // google/cloud-sdk:slim >= 592.0.0: no python3 on PATH, only gcloud's bundled Python.
    it('uses the gcloud-bundled Python when python3 is not on PATH', () => {
        const result = run(JSON.stringify({ A: SECRET }), { bundled: REAL_PYTHON })
        expect(result.status).toBe(0)
        expect(result.out).toContain(`validated with ${REAL_PYTHON}`)
    })

    it('honours CLOUDSDK_PYTHON', () => {
        const result = run(JSON.stringify({ A: 1 }), { cloudsdkPython: REAL_PYTHON })
        expect(result.status).toBe(0)
    })

    it('still rejects malformed JSON through the bundled Python', () => {
        const result = run(`{"A": ${SECRET}}`, { bundled: REAL_PYTHON })
        expect(result.status).toBe(1)
        expect(result.out + result.err).not.toContain(SECRET)
    })

    it('rejects valid JSON that is not an object', () => {
        const result = run(JSON.stringify([SECRET]), { python: true })
        expect(result.status).toBe(1)
        expect(result.err).toMatch(/expected an object/)
        expect(result.out + result.err).not.toContain(SECRET)
    })
})

describe('with Node only', () => {
    it('accepts a JSON object', () => {
        expect(run(JSON.stringify({ A: 1 }), { node: true }).status).toBe(0)
    })

    it('rejects malformed JSON without the slice V8 quotes', () => {
        const result = run(`{"A": ${SECRET}}`, { node: true })
        expect(result.status).toBe(1)
        expect(result.err).toMatch(/JSON syntax error/)
        expect(result.out + result.err).not.toContain(SECRET)
        expect(result.out + result.err).not.toContain('sk-')
    })

    it('rejects a top-level null', () => {
        const result = run('null', { node: true })
        expect(result.status).toBe(1)
        expect(result.err).toMatch(/null, expected an object/)
    })
})

describe('without any interpreter', () => {
    // The 2026-11-03 failure: the old check turned "python3: not found" into "not valid JSON".
    it('reports a missing interpreter as an image problem, not as an invalid secret', () => {
        const result = run(JSON.stringify({ A: SECRET }))
        expect(result.status).toBe(2)
        expect(result.err).toMatch(/no usable JSON interpreter/)
        expect(result.err).not.toMatch(/is not valid/)
        expect(result.out + result.err).not.toContain(SECRET)
    })
})

describe('content checks that need no interpreter', () => {
    it('rejects an empty variable (echo of an unset variable writes one newline)', () => {
        const result = run('\n')
        expect(result.status).toBe(1)
        expect(result.err).toMatch(/file is empty/)
    })

    it('rejects a missing file', () => {
        const result = run(undefined)
        expect(result.status).toBe(1)
        expect(result.err).toMatch(/does not exist/)
    })
})

describe('.gitlab-ci.yml', () => {
    const runnerJobs = ['deploy:cloud:runner:staging', 'deploy:cloud:runner:production']

    it.each(runnerJobs)('%s validates the env blob through the shared script', name => {
        const lines = [...(CI_CONFIG[name].before_script || []), ...(CI_CONFIG[name].script || [])]
        const writeIndex = lines.findIndex(line => /> functions\/env_functions\.json/.test(line))
        const checkIndex = lines.findIndex(line =>
            /ci\/validateJsonFile\.sh functions\/env_functions\.json /.test(line)
        )
        expect(writeIndex).toBeGreaterThanOrEqual(0)
        expect(checkIndex).toBeGreaterThan(writeIndex)
    })

    it('no cloud-sdk job relies on python3 being on PATH', () => {
        const offenders = Object.entries(CI_CONFIG)
            .filter(([, job]) => job && typeof job === 'object' && /google\/cloud-sdk/.test(String(job.image)))
            .filter(([, job]) =>
                [...(job.before_script || []), ...(job.script || [])].some(line => /(^|[\s;|&(])python3\s/.test(line))
            )
            .map(([name]) => name)
        expect(offenders).toEqual([])
    })
})
