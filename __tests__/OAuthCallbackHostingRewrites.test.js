const fs = require('fs')
const path = require('path')

const firebaseConfig = require('../firebase.json')

// Every OAuth/webhook callback that Cloud Functions build as `<app origin>/<name>Callback` is
// handed to a provider as a redirect URI, so it must reach the function on my.alldone.app. Without
// a hosting rewrite the request falls through to `** -> /index.html` and the provider's code lands
// in the SPA instead: /microsoftOAuthCallback answered with index.html in production for exactly
// that reason. The service worker must also leave those navigations to the network.

const ROOT = path.join(__dirname, '..')
const FUNCTIONS_DIR = path.join(ROOT, 'functions')

function listSourceFiles(dir) {
    const files = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) files.push(...listSourceFiles(fullPath))
        else if (/\.js$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) files.push(fullPath)
    }
    return files
}

// `${getBaseUrl()}/microsoftOAuthCallback`, `${baseUrl}/googleOAuthCallback`,
// `window.location.origin + '/mcpOAuthCallback'`.
const ORIGIN_CALLBACK_PATTERN = /(?:\$\{[^}]+\}|origin\s*\+\s*['"`])\/([A-Za-z][A-Za-z0-9]*Callback)\b/g

function collectOriginCallbackPaths() {
    const found = new Map()
    for (const file of listSourceFiles(FUNCTIONS_DIR)) {
        const source = fs.readFileSync(file, 'utf8')
        for (const match of source.matchAll(ORIGIN_CALLBACK_PATTERN)) {
            if (!found.has(match[1])) found.set(match[1], path.relative(ROOT, file))
        }
    }
    return found
}

function globToRegExp(glob) {
    const escaped = glob
        .split('**')
        .map(part =>
            part
                .split('*')
                .map(piece => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
                .join('[^/]*')
        )
        .join('.*')
    return new RegExp(`^${escaped}$`)
}

function findRewrite(requestPath) {
    return firebaseConfig.hosting.rewrites.find(rewrite => globToRegExp(rewrite.source).test(requestPath))
}

function rewriteFunctionId(rewrite) {
    if (!rewrite || !rewrite.function) return null
    return typeof rewrite.function === 'string' ? rewrite.function : rewrite.function.functionId
}

const functionsIndexSource = fs.readFileSync(path.join(FUNCTIONS_DIR, 'index.js'), 'utf8')

function exportedFunctionRegion(functionId) {
    const start = functionsIndexSource.indexOf(`exports.${functionId} = `)
    if (start < 0) return null
    const head = functionsIndexSource.slice(start, start + 400)
    const region = head.match(/region:\s*'([a-z0-9-]+)'/)
    return region ? region[1] : 'us-central1'
}

const swSource = fs.readFileSync(path.join(ROOT, 'web-bundler', 'service-worker.js'), 'utf8')

describe('OAuth callbacks built on the app origin', () => {
    const callbacks = collectOriginCallbackPaths()

    it('finds the callbacks the functions hand to providers', () => {
        // Guards the scan itself: if these disappear the pattern above stopped matching.
        expect([...callbacks.keys()]).toEqual(
            expect.arrayContaining([
                'googleOAuthCallback',
                'microsoftOAuthCallback',
                'mcpClientOAuthCallback',
                'mcpOAuthCallback',
            ])
        )
    })

    it.each([...collectOriginCallbackPaths().entries()])(
        '/%s (built in %s) is rewritten to its Cloud Function, not to the SPA',
        callbackName => {
            const rewrite = findRewrite(`/${callbackName}`)
            expect(rewrite).toBeDefined()
            expect(rewrite.destination).toBeUndefined()
            const functionId = rewriteFunctionId(rewrite)
            expect(functionId).toBe(callbackName)

            const deployedRegion = exportedFunctionRegion(functionId)
            expect(deployedRegion).not.toBeNull()
            if (typeof rewrite.function === 'object' && rewrite.function.region) {
                expect(rewrite.function.region).toBe(deployedRegion)
            }

            // Query strings carry the code and state; the rewrite must still match the bare path.
            expect(firebaseConfig.hosting.rewrites.indexOf(rewrite)).toBeLessThan(
                firebaseConfig.hosting.rewrites.findIndex(candidate => candidate.source === '**')
            )
        }
    )

    it.each([...collectOriginCallbackPaths().keys()])(
        'the service worker leaves the /%s navigation to the network',
        callbackName => {
            expect(swSource).toContain(`/\\/${callbackName}/`)
        }
    )
})
