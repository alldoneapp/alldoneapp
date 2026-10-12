const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const FULL_SUITE_INTERVAL_SECONDS = 24 * 60 * 60
const full = (head, reason, base = null) => ({ version: 1, mode: 'full', head, base, inputs: [], reason })
const broadChange = file =>
    /^(App[^/]*\.js|index\.js|app\.json|babel\.config\.js|tsconfig\.json|package(?:-lock)?\.json|\.npmrc|\.gitlab-ci\.yml)$/.test(
        file
    ) ||
    /^(ci\/|__mocks__\/|replacement_node_modules\/|web\/|web-bundler\/|redux\/(store|reducers|actions)|i18n\/)/.test(
        file
    )

function selectPlan({ changes, base, head, lastFullTestedAt, now = Date.now() / 1000, branch = false }) {
    if (!base) return full(head, 'No verified comparison commit; run every web suite')
    if (
        !branch &&
        (!Number.isFinite(lastFullTestedAt) ||
            lastFullTestedAt <= 0 ||
            lastFullTestedAt > now ||
            now - lastFullTestedAt >= FULL_SUITE_INTERVAL_SECONDS)
    )
        return full(head, 'Full web suite is due (at least once per 24 hours of deployments)', base)
    const patterns = fs
        .readFileSync(path.join(__dirname, 'deploy-scope/web-production.paths'), 'utf8')
        .split('\n')
        .map(line => line.replace(/#.*/, '').trim())
        .filter(Boolean)
        .map(pattern => new RegExp(pattern))
    const relevant = changes.filter(change => patterns.some(pattern => pattern.test(change.file)))
    const broad = relevant.find(change => broadChange(change.file))
    if (broad) return full(head, `Shared configuration or application-wide change: ${broad.file}`, base)
    const removed = relevant.find(change => change.status === 'D')
    if (removed) return full(head, `Removed or renamed dependency requires the old graph: ${removed.file}`, base)
    // Jest can trace JS/TS and JSON imports. Styles, assets and unknown formats
    // can affect rendering without an import edge in Jest's graph.
    const unsupported = relevant.find(change => !/\.[cm]?[jt]sx?$|\.json$|\.snap$/.test(change.file))
    if (unsupported) return full(head, `Cannot reliably trace this change: ${unsupported.file}`, base)
    const inputs = [...new Set(relevant.map(change => change.file))].sort()
    return {
        version: 1,
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
    if (!baseRef) return full(head, 'No verified deployment marker; run every web suite')
    try {
        let base = git(['rev-parse', '--verify', `${baseRef}^{commit}`]).trim()
        // Branch QA compares with its fork point. Deployment QA compares exact
        // trees, including catch-up changes, reverts and non-ancestor markers.
        if (options.branch) base = git(['merge-base', base, head]).trim()
        const fields = git(['diff', '--name-status', '--no-renames', '-z', base, head]).split('\0').filter(Boolean)
        const changes = []
        for (let index = 0; index < fields.length; index += 2)
            changes.push({ status: fields[index], file: fields[index + 1] })
        return selectPlan({ ...options, base, head, changes })
    } catch (_) {
        return full(head, 'Comparison cannot be established; run every web suite')
    }
}

if (require.main === module) {
    try {
        const [base, head, output, lastFullTestedAt] = process.argv.slice(2)
        if (!head || !output)
            throw new Error(
                'Usage: selectTargetedJestFiles.js <base-or-empty> <head> <plan.json> [last-full-test-time]'
            )
        const plan = makePlan(process.cwd(), base, head, { lastFullTestedAt: Number(lastFullTestedAt) })
        fs.writeFileSync(output, JSON.stringify(plan, null, 2) + '\n')
        console.log(`Web tests: ${plan.mode}. ${plan.reason}`)
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { selectPlan, makePlan, full, FULL_SUITE_INTERVAL_SECONDS }
