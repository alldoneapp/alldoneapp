const {
    OPENROUTER_PREFIX,
    isValidOpenRouterModelId,
    isOpenRouterSelection,
    toOpenRouterSelection,
    parseOpenRouterSelection,
    resolveModelRoute,
    isOpenRouterRun,
    formatOpenRouterModelLabel,
    resolveCredentialProvider,
    resolveJobCredentialProvider,
    providerSupportsSubscription,
} = require('./vmModelRouting')

describe('OpenRouter model selection encoding (AT-2230)', () => {
    test('accepts real OpenRouter ids, including variant suffixes', () => {
        expect(isValidOpenRouterModelId('deepseek/deepseek-chat')).toBe(true)
        expect(isValidOpenRouterModelId('deepseek/deepseek-v3.2')).toBe(true)
        expect(isValidOpenRouterModelId('deepseek/deepseek-r1:free')).toBe(true)
        expect(isValidOpenRouterModelId('z-ai/glm-4.6')).toBe(true)
    })

    test('rejects ids that are not vendor/model', () => {
        expect(isValidOpenRouterModelId('deepseek')).toBe(false)
        expect(isValidOpenRouterModelId('gpt-5.6-sol')).toBe(false)
        expect(isValidOpenRouterModelId('')).toBe(false)
        expect(isValidOpenRouterModelId(null)).toBe(false)
    })

    // The model string is interpolated into a shell command and a TOML value. Anything that could
    // break out of either must never validate, no matter how the id arrives.
    test('rejects shell and config metacharacters', () => {
        const hostile = [
            'deepseek/deepseek; rm -rf /',
            'deepseek/deepseek$(id)',
            'deepseek/deepseek`id`',
            "deepseek/deepseek'",
            'deepseek/deepseek"',
            'deepseek/deepseek chat',
            'deepseek/deepseek|cat',
            'deepseek/deepseek\nrm',
            '../../etc/passwd',
        ]
        for (const id of hostile) {
            expect(isValidOpenRouterModelId(id)).toBe(false)
            expect(parseOpenRouterSelection(`${OPENROUTER_PREFIX}${id}`)).toBeNull()
        }
    })

    test('round-trips a selection', () => {
        const selection = toOpenRouterSelection('deepseek/deepseek-chat')
        expect(selection).toBe('openrouter:deepseek/deepseek-chat')
        expect(isOpenRouterSelection(selection)).toBe(true)
        expect(parseOpenRouterSelection(selection)).toBe('deepseek/deepseek-chat')
    })

    test('a malformed suffix parses to null rather than leaking raw text to the CLI', () => {
        expect(parseOpenRouterSelection('openrouter:not a model')).toBeNull()
        expect(parseOpenRouterSelection('openrouter:')).toBeNull()
    })

    describe('resolveModelRoute', () => {
        test('strips the routing marker so the CLI only sees the provider id', () => {
            expect(resolveModelRoute('codex', 'openrouter:deepseek/deepseek-chat')).toEqual({
                source: 'openrouter',
                model: 'deepseek/deepseek-chat',
                selection: 'openrouter:deepseek/deepseek-chat',
            })
        })

        test('leaves native OpenAI and Claude models exactly as before', () => {
            expect(resolveModelRoute('codex', 'gpt-5.6-sol')).toEqual({
                source: 'openai',
                model: 'gpt-5.6-sol',
                selection: 'gpt-5.6-sol',
            })
            expect(resolveModelRoute('claude', 'opus')).toEqual({
                source: 'anthropic',
                model: 'opus',
                selection: 'opus',
            })
        })

        // A prefix that survived into a job doc but no longer parses must not fail the run; it
        // degrades to the pre-feature route.
        test('an unparseable selection falls back to the OpenAI route', () => {
            expect(resolveModelRoute('codex', 'openrouter:bogus id').source).toBe('openai')
        })

        test('a Claude agent never routes to OpenRouter', () => {
            expect(isOpenRouterRun('claude', 'openrouter:deepseek/deepseek-chat')).toBe(false)
            expect(isOpenRouterRun('codex', 'openrouter:deepseek/deepseek-chat')).toBe(true)
        })
    })

    describe('formatOpenRouterModelLabel', () => {
        test('does not repeat the vendor when the model name already carries it', () => {
            expect(formatOpenRouterModelLabel('deepseek/deepseek-chat')).toBe('DeepSeek Chat')
        })

        test('keeps the vendor when the model name does not repeat it', () => {
            expect(formatOpenRouterModelLabel('z-ai/glm-4.6')).toBe('Z.AI Glm 4.6')
        })

        test('surfaces the variant', () => {
            expect(formatOpenRouterModelLabel('deepseek/deepseek-r1:free')).toBe('DeepSeek R1 (free)')
        })
    })
})

describe('credential provider resolution (AT-2230 BYOK)', () => {
    // The whole point: an OpenRouter run drives the Codex harness but authenticates elsewhere.
    // Keying credentials on the agent would spend the user's OpenAI key against OpenRouter.
    test('an OpenRouter model resolves its own slot, not the codex one', () => {
        expect(resolveCredentialProvider('codex', 'openrouter:deepseek/deepseek-chat')).toBe('openrouter')
        expect(resolveCredentialProvider('codex', 'gpt-5.6-sol')).toBe('codex')
        expect(resolveCredentialProvider('claude', 'opus')).toBe('claude')
    })

    test('an OpenRouter model paired with Claude is not an OpenRouter credential route', () => {
        // resolveModelRoute already refuses that combination, so the credential must follow it.
        expect(resolveCredentialProvider('claude', 'openrouter:deepseek/deepseek-chat')).toBe('claude')
    })

    test('a malformed OpenRouter selection falls back to the OpenAI slot, matching the model route', () => {
        expect(resolveCredentialProvider('codex', 'openrouter:bogus id')).toBe('codex')
    })

    describe('resolveJobCredentialProvider', () => {
        test('prefers the value persisted on the job', () => {
            expect(
                resolveJobCredentialProvider({
                    agent: 'codex',
                    agentModel: 'gpt-5.6-sol',
                    credentialProvider: 'openrouter',
                })
            ).toBe('openrouter')
        })

        // Backward compatibility: every job doc written before this field existed.
        test('derives from agent + model when the field is absent', () => {
            expect(
                resolveJobCredentialProvider({ agent: 'codex', agentModel: 'openrouter:deepseek/deepseek-chat' })
            ).toBe('openrouter')
            expect(resolveJobCredentialProvider({ agent: 'codex', agentModel: 'gpt-5.6-sol' })).toBe('codex')
            expect(resolveJobCredentialProvider({})).toBe('claude')
        })

        test('ignores a persisted value that is not a known provider', () => {
            expect(
                resolveJobCredentialProvider({ agent: 'codex', agentModel: 'gpt-5.6-sol', credentialProvider: 'evil' })
            ).toBe('codex')
        })
    })

    test('only OpenAI and Anthropic have a connectable subscription', () => {
        expect(providerSupportsSubscription('claude')).toBe(true)
        expect(providerSupportsSubscription('codex')).toBe(true)
        expect(providerSupportsSubscription('openrouter')).toBe(false)
    })
})
