/**
 * Guards the offline app-shell contract (OFFLINE_SUPPORT_PLAN.md Stage 2):
 * production builds ship a workbox service worker that precaches the shell, the
 * legacy cache-nuking SW stays retired, and dev keeps a no-op SW at the same URL.
 */
const fs = require('fs')
const path = require('path')

const rootDir = path.resolve(__dirname, '..')
const createWebpackConfig = require('../web-bundler/webpack.config.js')

const swSource = fs.readFileSync(path.join(rootDir, 'web-bundler', 'service-worker.js'), 'utf8')

describe('workbox service worker source', () => {
    it('precaches the injected manifest', () => {
        expect(swSource).toContain('precacheAndRoute(self.__WB_MANIFEST)')
        expect(swSource).toContain('cleanupOutdatedCaches()')
    })

    it('never deletes caches wholesale on activate (the legacy v1.9 behavior)', () => {
        expect(swSource).not.toMatch(/caches\s*\.\s*keys/)
        expect(swSource).not.toMatch(/caches\s*\.\s*delete/)
    })

    it('keeps the OAuth/MCP navigations out of the navigation route', () => {
        // These endpoints answer with redirects; a SW-handled navigation turns the
        // 302 into an opaque-redirect and breaks the flow (see the old SW's list).
        for (const fragment of [
            '__\\/auth',
            'googleOAuthCallback',
            'mcpServer',
            'mcpOAuthCallback',
            'mcpClientOAuthCallback',
            'well-known\\/oauth',
        ]) {
            expect(swSource).toContain(fragment)
        }
    })

    it('does not intercept video, whose Range requests break against cached bodies', () => {
        expect(swSource).toContain('mp4')
    })
})

describe('web-bundler webpack config', () => {
    it('injects the precache manifest in production at the legacy SW URL', () => {
        const config = createWebpackConfig(undefined, { mode: 'production' })
        const injectManifest = config.plugins.find(plugin => plugin.constructor.name === 'InjectManifest')
        expect(injectManifest).toBeDefined()
        expect(injectManifest.config.swDest).toBe('service-worker.js')
        // firebase-messaging-sw.js is its own service worker with sed-injected env
        // placeholders — it must always be fetched fresh, never precached.
        expect(String(injectManifest.config.exclude)).toContain('firebase-messaging-sw')
    })

    it('ships the no-op dev SW instead of precaching HMR chunks in development', () => {
        const config = createWebpackConfig(undefined, { mode: 'development' })
        expect(config.plugins.find(plugin => plugin.constructor.name === 'InjectManifest')).toBeUndefined()
        const copyPlugin = config.plugins.find(plugin => plugin.constructor.name === 'CopyPlugin')
        const patternSources = copyPlugin.patterns.map(pattern => pattern.from)
        expect(patternSources.some(source => source.includes('service-worker.dev.js'))).toBe(true)
    })
})

describe('service worker files', () => {
    it('keeps the legacy cache-nuking web/service-worker.js retired', () => {
        expect(fs.existsSync(path.join(rootDir, 'web', 'service-worker.js'))).toBe(false)
    })

    it('still registers the SW at the URL existing clients hold', () => {
        const handler = fs.readFileSync(path.join(rootDir, 'web', 'service-worker-handler.js'), 'utf8')
        expect(handler).toContain("register('/service-worker.js'")
    })

    it('keeps deleteCache away from the workbox precache', () => {
        const observers = fs.readFileSync(path.join(rootDir, 'utils', 'Observers.js'), 'utf8')
        expect(observers).toContain("name.startsWith('workbox-precache')")
    })
})
