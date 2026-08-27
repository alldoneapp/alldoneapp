const fs = require('fs')
const path = require('path')

const ENV_JSON_PATH = path.join(__dirname, 'env_functions.json')

/**
 * getEnvFunctions() maps a CI-provided JSON blob onto a fixed set of fields. It is an explicit
 * ALLOWLIST, not a passthrough — a key present in GOOGLE_FUNCTIONS_ENV_DEV / _PROD but absent from
 * the map is silently invisible to every caller, with no warning and no failure at deploy time.
 *
 * That is exactly how AT-2230 shipped: OPENROUTER_API_KEY was added to the CI variable and still
 * read as unconfigured, so `isOpenRouterConfigured()` was false, the Settings source toggle stayed
 * hidden, and startVmJob refused every OpenRouter model. These tests pin the key through each of the
 * four branches so the same class of silent gap cannot recur unnoticed for this secret.
 */
describe('getEnvFunctions OPENROUTER_API_KEY plumbing (AT-2230)', () => {
    const originalEnv = { ...process.env }
    let hadEnvJson

    beforeAll(() => {
        hadEnvJson = fs.existsSync(ENV_JSON_PATH)
    })

    beforeEach(() => {
        jest.resetModules()
        delete process.env.FUNCTIONS_EMULATOR
        delete process.env.OPENROUTER_API_KEY
        delete process.env.TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY
    })

    afterEach(() => {
        // Only ever remove a file this test created; never touch a real deployed one.
        if (!hadEnvJson && fs.existsSync(ENV_JSON_PATH)) fs.unlinkSync(ENV_JSON_PATH)
        process.env = { ...originalEnv }
    })

    const load = () => require('./envFunctionsHelper').getEnvFunctions()

    const writeEnvJson = contents => {
        if (hadEnvJson) return false
        fs.writeFileSync(ENV_JSON_PATH, JSON.stringify(contents), 'utf8')
        return true
    }

    test('is read from env_functions.json, which is what CI writes the GitLab blob into', () => {
        // Skip rather than clobber a real env_functions.json in a working deploy checkout.
        if (
            !writeEnvJson({
                OPENROUTER_API_KEY: 'or-json-key',
                TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY: 'typesense-parent-key',
                PERPLEXITY_API_KEY: 'real-perplexity-value',
            })
        )
            return

        const env = load()
        expect(env.OPENROUTER_API_KEY).toBe('or-json-key')
        expect(env.TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY).toBe('typesense-parent-key')
    })

    test('falls back to process.env when the JSON has no entry for it', () => {
        if (!writeEnvJson({ PERPLEXITY_API_KEY: 'real-perplexity-value' })) return
        process.env.OPENROUTER_API_KEY = 'or-process-key'

        expect(load().OPENROUTER_API_KEY).toBe('or-process-key')
    })

    test('is present (empty, never undefined) when configured nowhere', () => {
        if (!writeEnvJson({ PERPLEXITY_API_KEY: 'real-perplexity-value' })) return

        // Empty string, not undefined: callers test truthiness, and an undefined field reads the
        // same but hides whether the key is missing or the mapping is.
        expect(load().OPENROUTER_API_KEY).toBe('')
    })

    test('is read from the .env file in emulator mode', () => {
        process.env.FUNCTIONS_EMULATOR = 'true'
        process.env.OPENROUTER_API_KEY = 'or-emulator-key'

        expect(load().OPENROUTER_API_KEY).toBe('or-emulator-key')
    })

    test('resolves from process.env when there is no JSON file at all', () => {
        if (hadEnvJson) return
        process.env.OPENROUTER_API_KEY = 'or-no-json-key'

        expect(load().OPENROUTER_API_KEY).toBe('or-no-json-key')
    })

    test('resolves the scoped Typesense parent key from process.env when JSON does not contain it', () => {
        process.env.TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY = 'typesense-process-key'

        expect(load().TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY).toBe('typesense-process-key')
    })

    // The key travels to the Cloud Run runner image through the SAME variable (CI writes
    // functions/env_functions.json in deploy:cloud:runner:*), so both runtimes read one field name.
    test('exposes exactly the field name the proxy and runner look up', () => {
        if (!writeEnvJson({ OPENROUTER_API_KEY: 'or-json-key', PERPLEXITY_API_KEY: 'real-perplexity-value' })) return

        const env = load()
        const { resolveProvider } = require('./Assistant/vmLlmProxy')
        expect(env).toHaveProperty(resolveProvider('/openrouter/v1/chat/completions').config.realKeyField)
    })
})
