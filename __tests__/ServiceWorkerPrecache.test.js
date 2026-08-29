/**
 * Guards the offline app-shell contract (OFFLINE_SUPPORT_PLAN.md Stage 2):
 * production builds ship a workbox service worker that precaches the shell, the
 * legacy cache-nuking SW stays retired, and dev keeps a no-op SW at the same URL.
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const rootDir = path.resolve(__dirname, '..')

const swSource = fs.readFileSync(path.join(rootDir, 'web-bundler', 'service-worker.js'), 'utf8')
const handlerSource = fs.readFileSync(path.join(rootDir, 'web', 'service-worker-handler.js'), 'utf8')
const webpackConfigSource = fs.readFileSync(path.join(rootDir, 'web-bundler', 'webpack.config.js'), 'utf8')

// Instantiating the real config needs web-bundler's own node_modules (webpack,
// workbox-webpack-plugin, the resolve.fallback shims like `buffer/`). CI's
// test:web:changed job only symlinks the ROOT node_modules, so the functional
// checks below run locally (and anywhere `(cd web-bundler && npm install)` has
// run) and are skipped in CI — where build_web_webpack_check compiles the real
// config in the same pipeline, and the static-source checks still run.
const webBundlerDepsInstalled = ['workbox-webpack-plugin', 'buffer', 'webpack'].every(dep =>
    fs.existsSync(path.join(rootDir, 'web-bundler', 'node_modules', dep))
)
const describeWithBundlerDeps = webBundlerDepsInstalled ? describe : describe.skip
// Guarded at module scope: describe.skip bodies still execute at collection
// time, so an unconditional require would throw in CI anyway.
const createWebpackConfig = webBundlerDepsInstalled ? require('../web-bundler/webpack.config.js') : null

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

    it('bypasses the browser HTTP cache for network-first navigation checks', () => {
        expect(swSource).toContain("fetchOptions: { cache: 'no-store' }")
    })
})

describe('web-bundler webpack config source (runs everywhere)', () => {
    it('wires InjectManifest for production at the legacy SW URL', () => {
        expect(webpackConfigSource).toContain('new InjectManifest')
        expect(webpackConfigSource).toContain("swDest: 'service-worker.js'")
        expect(webpackConfigSource).toContain('firebase-messaging-sw')
    })

    it('copies the no-op dev SW in development', () => {
        expect(webpackConfigSource).toContain('service-worker.dev.js')
    })
})

describeWithBundlerDeps('web-bundler webpack config (needs web-bundler/node_modules)', () => {
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
        expect(handlerSource).toContain("register('/service-worker.js'")
    })

    it('reloads a stale boot shell once after the current worker activates', () => {
        expect(handlerSource).toContain('startup-shell-check=')
        expect(handlerSource).toContain("{ cache: 'no-store' }")
        expect(handlerSource).toContain('waitForWorkerActivation')
        expect(handlerSource).toContain('window.location.reload()')
        expect(handlerSource).toContain('alldone_stale_shell_reload_target')
    })

    it('detects and reloads a stale hashed bundle while online', async () => {
        let onLoad
        const reload = jest.fn()
        const update = jest.fn(() => Promise.resolve())
        const storage = new Map()
        const context = {
            Array,
            Date,
            Promise,
            String,
            clearTimeout,
            console,
            document: { scripts: [{ src: 'https://my.alldone.app/static/js/main.old.js' }] },
            fetch: jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve('<script src="/static/js/main.new.js"></script>'),
                })
            ),
            navigator: {
                serviceWorker: {
                    getRegistration: () => Promise.resolve({ update, installing: null, waiting: null }),
                    register: jest.fn(),
                },
            },
            sessionStorage: {
                getItem: key => storage.get(key) || null,
                removeItem: key => storage.delete(key),
                setItem: (key, value) => storage.set(key, value),
            },
            setTimeout,
            window: {
                addEventListener: (event, callback) => {
                    if (event === 'load') onLoad = callback
                },
                location: { reload },
            },
        }

        vm.runInNewContext(handlerSource, context)
        await onLoad()

        expect(context.fetch).toHaveBeenCalledWith(expect.stringContaining('startup-shell-check='), {
            cache: 'no-store',
        })
        expect(update).toHaveBeenCalledTimes(1)
        expect(storage.get('alldone_stale_shell_reload_target')).toBe('/static/js/main.old.js->/static/js/main.new.js')
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it('keeps the cached shell when the startup version check is offline', async () => {
        let onLoad
        const reload = jest.fn()
        const context = {
            Array,
            Date,
            Promise,
            String,
            clearTimeout,
            console,
            document: { scripts: [{ src: 'https://my.alldone.app/static/js/main.cached.js' }] },
            fetch: jest.fn(() => Promise.reject(new Error('offline'))),
            navigator: {
                serviceWorker: {
                    getRegistration: () => Promise.resolve({ update: jest.fn() }),
                    register: jest.fn(),
                },
            },
            sessionStorage: { getItem: jest.fn(), removeItem: jest.fn(), setItem: jest.fn() },
            setTimeout,
            window: {
                addEventListener: (event, callback) => {
                    if (event === 'load') onLoad = callback
                },
                location: { reload },
            },
        }

        vm.runInNewContext(handlerSource, context)
        await onLoad()

        expect(reload).not.toHaveBeenCalled()
    })

    it('keeps deleteCache away from the workbox precache', () => {
        const observers = fs.readFileSync(path.join(rootDir, 'utils', 'Observers.js'), 'utf8')
        expect(observers).toContain("name.startsWith('workbox-precache')")
    })
})
