const { execFileSync } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

// Exit codes are how test:web:changed tells "nothing to test" apart from "the
// selection never happened". Only an empty selection may exit 0; every failure
// below has to be non-zero, because a silent empty list turns the job into a
// no-op that still reports success.
const EXIT_USAGE = 2
const EXIT_UNRESOLVED_REF = 3
const EXIT_NO_MERGE_BASE = 4
const EXIT_DIFF_FAILED = 5

const baseRef = process.argv[2]
const headRef = process.argv[3] || 'HEAD'

const excludedRoots = [
    'ci/',
    'cloudflare/',
    'firebase_tool/',
    'firestore-backups/',
    'functions/',
    'migration/',
    // Shared manual mocks are test scaffolding, not application sources. Jest
    // relates them to every suite that touches the module they stand in for, so
    // handing one to --findRelatedTests selects a large arbitrary slice of the
    // suite and defeats the point of a targeted run. The suites that matter for
    // a mock change are reached through the sources and tests changed with it.
    '__mocks__/',
]
const testPattern = /(?:^|\/)__tests__\/|[.](?:test|spec)[.][jt]sx?$/
const codePattern = /[.][jt]sx?$/

// Diagnostics go to stderr so stdout stays the NUL-delimited list the job pipes
// into xargs.
const note = message => process.stderr.write(`${message}\n`)

const fail = (code, message) => {
    process.stderr.write(`ci/selectTargetedJestFiles.js: ${message}\n`)
    process.exit(code)
}

const git = args =>
    execFileSync('git', args, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    })

const gitStderr = error => String((error && error.stderr) || '').trim()

const resolveCommit = ref => {
    try {
        return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim()
    } catch (error) {
        return ''
    }
}

if (!baseRef) {
    fail(EXIT_USAGE, 'usage: node ci/selectTargetedJestFiles.js <base-ref> [head-ref]')
}

const baseSha = resolveCommit(baseRef)
if (!baseSha) {
    fail(
        EXIT_UNRESOLVED_REF,
        `cannot resolve base ref "${baseRef}". In CI the default branch is fetched by ci/ensureMergeBase.sh; ` +
            'without it there is no comparison point and the run would silently select nothing.'
    )
}

const headSha = resolveCommit(headRef)
if (!headSha) {
    fail(EXIT_UNRESOLVED_REF, `cannot resolve head ref "${headRef}".`)
}

// Resolve the merge base explicitly instead of relying on `base...head`. The
// three-dot form fails the same way whether the history is shallow or the refs
// are unrelated, and that failure used to reach the job as an empty selection.
let mergeBase
try {
    mergeBase = git(['merge-base', baseSha, headSha]).trim()
} catch (error) {
    fail(
        EXIT_NO_MERGE_BASE,
        `"${baseRef}" and "${headRef}" have no common ancestor in this clone` +
            `${gitStderr(error) ? ` (git: ${gitStderr(error)})` : ''}. ` +
            'A shallow CI clone cut too early is the usual cause; ci/ensureMergeBase.sh deepens it before this runs.'
    )
}

const short = sha => sha.slice(0, 9)

if (mergeBase === headSha) {
    // The branch has already been merged (or fast-forwarded) into the base, so
    // the branch diff is empty by definition. Legitimately zero, but worth
    // saying out loud: nothing this pipeline reports covers the commit.
    note(
        `Targeted Jest selection: "${baseRef}" already contains ${short(headSha)}, so the branch diff is empty. ` +
            'Selecting no files.'
    )
    process.exit(0)
}

let rawDiff
try {
    rawDiff = git(['diff', '--name-only', '-z', mergeBase, headSha, '--'])
} catch (error) {
    fail(
        EXIT_DIFF_FAILED,
        `git diff ${short(mergeBase)}..${short(headSha)} failed${gitStderr(error) ? `: ${gitStderr(error)}` : '.'}`
    )
}

const changedPaths = rawDiff.split('\0').filter(Boolean)
const changedFiles = changedPaths
    .filter(file => existsSync(file))
    .filter(file => codePattern.test(file))
    .filter(file => !excludedRoots.some(root => file.startsWith(root)))

const changedTests = changedFiles.filter(file => testPattern.test(file))
const changedTestStems = new Set(
    changedTests
        .filter(file => !file.includes('/__tests__/') && !file.startsWith('__tests__/'))
        .map(file => file.replace(/[.](?:test|spec)[.][jt]sx?$/, ''))
)
const uncoveredSources = changedFiles.filter(file => {
    if (testPattern.test(file)) return false
    return !changedTestStems.has(file.replace(/[.][jt]sx?$/, ''))
})

const selected = [...changedTests, ...uncoveredSources]

note(
    `Targeted Jest selection: ${selected.length} file(s) from ${changedPaths.length} changed in ` +
        `${baseRef}...${headRef} (merge base ${short(mergeBase)}).`
)
if (selected.length === 0) {
    note('No web-relevant JavaScript changed, so the targeted run has nothing to do.')
}

for (const file of selected) {
    process.stdout.write(`${path.normalize(file)}\0`)
}
