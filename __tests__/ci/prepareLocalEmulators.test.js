/** @jest-environment node */

const fs = require('fs')
const vm = require('vm')
const { patchEmulatorRuntime, CONFIG_HELPER_START, SDK_V7_GUARD } = require('../../ci/prepare-local-emulators')

// Exercise the actual pinned CLI helper, including its pre-fix crash, rather than
// a copy of the upstream implementation that could drift independently.
const installedRuntime = fs.readFileSync(
    require.resolve('firebase-tools/lib/emulator/functionsEmulatorRuntime'),
    'utf8'
)
const originalRuntime = installedRuntime.replace(CONFIG_HELPER_START + SDK_V7_GUARD, CONFIG_HELPER_START)
const patchedRuntime = patchEmulatorRuntime(originalRuntime, '13.29.3')

function runConfigHelper(source, version, config) {
    const start = source.indexOf('async function initializeFunctionsConfigHelper()')
    const end = source.indexOf('\nfunction rawBodySaver', start)
    const functionsModule = { config }
    const requireModule = () => functionsModule
    requireModule.cache = { '/functions/index.js': { exports: functionsModule } }
    const context = {
        assertResolveDeveloperNodeModule: async () => ({ version, resolution: '/functions/index.js' }),
        require: requireModule,
        logDebug: () => {},
        path: require('path'),
        // Only the legacy SDK reaches proxy setup; this test keeps its config intact.
        Proxied: class {
            constructor(value) {
                this.value = value
            }
            any() {
                return this
            }
            when() {
                return this
            }
            finalize() {
                return this.value
            }
        },
    }
    return vm.runInNewContext(`${source.slice(start, end)}; initializeFunctionsConfigHelper()`, context)
}

test('SDK 7 invocations skip the removed config API that crashes the unpatched emulator', async () => {
    const config = jest.fn(() => {
        throw new Error('functions.config() has been removed in firebase-functions v7')
    })
    await expect(runConfigHelper(originalRuntime, '7.3.2', config)).rejects.toThrow('has been removed')
    config.mockClear()
    await expect(runConfigHelper(patchedRuntime, '7.3.2', config)).resolves.toBeUndefined()
    expect(config).not.toHaveBeenCalled()
})

test('older SDKs retain their runtime configuration', async () => {
    const config = jest.fn(() => ({ service: { enabled: true } }))
    await expect(runConfigHelper(patchedRuntime, '6.0.0', config)).resolves.toBeUndefined()
    expect(config).toHaveBeenCalledTimes(2)
})

test('preparing again is idempotent and unknown CLI versions or layouts fail explicitly', () => {
    expect(patchEmulatorRuntime(patchedRuntime, '13.29.3')).toBe(patchedRuntime)
    expect(() => patchEmulatorRuntime(originalRuntime, '15.32.1')).toThrow('Review')
    expect(() => patchEmulatorRuntime('changed runtime', '13.29.3')).toThrow('runtime changed')
})
