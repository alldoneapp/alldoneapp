const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const full = (head, reason, base = null, kind = 'web') => ({
    version: 1,
    kind,
    mode: 'full',
    head,
    base,
    inputs: [],
    reason,
})
const broadChange = file =>
    /^(App[^/]*\.js|index\.js|app\.json|babel\.config\.js|tsconfig\.json|package(?:-lock)?\.json|\.npmrc)$/.test(
        file
    ) ||
    /^(__mocks__\/|replacement_node_modules\/|web\/|web-bundler\/|redux\/(store|reducers|actions)|i18n\/)/.test(file)

function selectPlan({ changes, base, head, kind = 'web', runtimeFiles = [] }) {
    const fallback = reason => full(head, reason, base, kind)
    if (!base) return fallback('No verified comparison commit; run every suite')
    const patterns = fs
        .readFileSync(path.join(__dirname, 'deploy-scope/web-production.paths'), 'utf8')
        .split('\n')
        .map(line => line.replace(/#.*/, '').trim())
        .filter(Boolean)
        .map(pattern => new RegExp(pattern))
    const dependencies = new Set(runtimeFiles)
    const relevant = changes.filter(({ file }) =>
        kind === 'functions'
            ? (file.startsWith('functions/') && !/(^|\/)(README|CHANGELOG|AGENTS|CLAUDE)\.md$/i.test(file)) ||
              dependencies.has(file) ||
              /^__tests__\/(TwilioWhatsAppService|Chats\/copyChatToOtherProject|Feeds\/copyInnerFeedsToOtherProject)\.test\.js$/.test(
                  file
              ) ||
              /^(package(?:-lock)?\.json|babel\.config\.js|ci\/(jest\.functions\.config|jestSetup|jestPolyfills|writeTestEnv)\.js)$/.test(
                  file
              )
            : patterns.some(pattern => pattern.test(file)) &&
              file !== '__tests__/Firestore/firestoreRules.emulator.test.js'
    )
    const broad = relevant.find(({ file }) =>
        kind === 'functions'
            ? /^(functions\/(package(?:-lock)?\.json|firebaseConfig\.js)|package(?:-lock)?\.json|babel\.config\.js|ci\/(jest\.functions\.config|jestSetup|jestPolyfills|writeTestEnv)\.js)$/.test(
                  file
              )
            : broadChange(file) || /^ci\/(jest\.web\.config|jestSetup|jestPolyfills|writeTestEnv)\.js$/.test(file)
    )
    if (broad) return fallback(`Shared configuration or application-wide change: ${broad.file}`)
    const removed = relevant.find(change => change.status === 'D')
    if (removed) return fallback(`Removed or renamed dependency requires the old graph: ${removed.file}`)
    // Jest traces imports; CI scripts and path lists use source-reading tests.
    // The runner still falls back to full validation for any unmapped input.
    // Styles, assets and unknown product formats can affect rendering without an edge.
    const unsupported = relevant.find(
        change =>
            !/\.[cm]?[jt]sx?$|\.json$|\.snap$|^\.gitlab-ci\.yml$|^\.firebaserc$|^ci\/.*\.(sh|paths)$/.test(change.file)
    )
    if (unsupported) return fallback(`Cannot reliably trace this change: ${unsupported.file}`)
    const inputs = [...new Set(relevant.map(change => change.file))].sort()
    return {
        version: 1,
        kind,
        mode: inputs.length ? 'targeted' : 'none',
        base,
        head,
        inputs,
        reason: inputs.length
            ? 'All changed sources, data and tests, including their dependent suites'
            : 'No web changes',
    }
}

function makePlan(root, baseRef, headRef = 'HEAD', options = {}) {
    const git = args =>
        execFileSync('git', ['-C', root, ...args], {
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    const head = git(['rev-parse', '--verify', `${headRef}^{commit}`]).trim()
    const kind = options.kind || 'web'
    if (!baseRef) return full(head, 'No verified deployment marker; run every suite', null, kind)
    try {
        let base = git(['rev-parse', '--verify', `${baseRef}^{commit}`]).trim()
        // Branch QA compares with its fork point. Deployment QA compares exact
        // trees, including catch-up changes, reverts and non-ancestor markers.
        if (options.branch) base = git(['merge-base', base, head]).trim()
        const fields = git(['diff', '--name-status', '--no-renames', '-z', base, head]).split('\0').filter(Boolean)
        const changes = []
        for (let index = 0; index < fields.length; index += 2)
            changes.push({ status: fields[index], file: fields[index + 1] })
        let runtimeFiles = []
        if (kind === 'functions') {
            const { buildGraph, gitTree } = require('./selectFunctionsDeployment')
            const blobs = new Map()
            runtimeFiles = [
                ...buildGraph(gitTree(root, base, blobs)).values(),
                ...buildGraph(gitTree(root, head, blobs)).values(),
            ].flatMap(info => [...info.files])
        }
        return selectPlan({ ...options, kind, base, head, changes, runtimeFiles })
    } catch (_) {
        return full(head, 'Comparison cannot be established; run every suite', null, kind)
    }
}

if (require.main === module) {
    try {
        const [base, head, output, option] = process.argv.slice(2)
        if (!head || !output)
            throw new Error(
                'Usage: selectTargetedJestFiles.js <base-or-empty> <head> <plan.json> [last-full-test-time]'
            )
        const plan = makePlan(process.cwd(), base, head, {
            kind: option === '--functions' ? 'functions' : 'web',
        })
        fs.writeFileSync(output, JSON.stringify(plan, null, 2) + '\n')
        console.log(`Web tests: ${plan.mode}. ${plan.reason}`)
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { selectPlan, makePlan, full }
