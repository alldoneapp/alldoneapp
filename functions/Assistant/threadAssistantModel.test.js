const {
    INHERIT_ASSISTANT_MODEL,
    THREAD_ASSISTANT_MODEL_FIELD,
    THREAD_ASSISTANT_MODEL_OPTIONS,
    getThreadAssistantModelName,
    getThreadAssistantModelOverride,
    getThreadAssistantModelSelection,
    isSelectableThreadAssistantModel,
    normalizeThreadAssistantModelSelection,
    resolveThreadAssistantModel,
} = require('./threadAssistantModel')
const { SELECTABLE_ASSISTANT_MODELS } = require('./selectableAssistantModels')

describe('per-thread assistant model override (AT-2502)', () => {
    describe('reading the override off a thread document', () => {
        it('returns a pinned selectable model', () => {
            const thread = { [THREAD_ASSISTANT_MODEL_FIELD]: 'MODEL_GPT5_6_TERRA' }

            expect(getThreadAssistantModelOverride(thread)).toBe('MODEL_GPT5_6_TERRA')
            expect(getThreadAssistantModelSelection(thread)).toBe('MODEL_GPT5_6_TERRA')
        })

        it.each([
            ['no document at all', undefined],
            ['a document without the field', {}],
            ['an explicitly cleared override', { [THREAD_ASSISTANT_MODEL_FIELD]: null }],
            ['a blank override', { [THREAD_ASSISTANT_MODEL_FIELD]: '   ' }],
            ['a non-string override', { [THREAD_ASSISTANT_MODEL_FIELD]: 3 }],
        ])('inherits the assistant model for %s', (_label, thread) => {
            expect(getThreadAssistantModelOverride(thread)).toBeNull()
            expect(getThreadAssistantModelSelection(thread)).toBe(INHERIT_ASSISTANT_MODEL)
        })

        // The whole reason the read validates rather than trusting. `getModel` answers
        // 'gpt-5.6-sol' for an unknown key while `getTokensPerGold` answers undefined, and
        // `calculateGoldCostFromTokens` turns that into a charge of ZERO — so a thread pinned to
        // a model that is later retired would run free and silently, forever.
        it('ignores a model key that is no longer selectable', () => {
            const thread = { [THREAD_ASSISTANT_MODEL_FIELD]: 'MODEL_GPT5_5' }

            expect(isSelectableThreadAssistantModel('MODEL_GPT5_5')).toBe(false)
            expect(getThreadAssistantModelOverride(thread)).toBeNull()
            expect(getThreadAssistantModelSelection(thread)).toBe(INHERIT_ASSISTANT_MODEL)
        })
    })

    describe('normalizing a picker choice on its way to storage', () => {
        it('keeps a selectable model', () => {
            expect(normalizeThreadAssistantModelSelection('MODEL_DEEPSEEK_V4_FLASH')).toBe('MODEL_DEEPSEEK_V4_FLASH')
        })

        it.each([
            ['the inherit entry', INHERIT_ASSISTANT_MODEL],
            ['an empty choice', ''],
            ['a retired model', 'MODEL_GPT5_5'],
            ['a non-string', null],
        ])('clears the override for %s', (_label, selection) => {
            expect(normalizeThreadAssistantModelSelection(selection)).toBeNull()
        })

        // Storing a value the reader would refuse would leave the UI showing a pinned model the
        // runs do not use — the worst of both.
        it('never stores a value its own reader would reject', () => {
            const candidates = [
                ...SELECTABLE_ASSISTANT_MODELS.map(option => option.model),
                INHERIT_ASSISTANT_MODEL,
                'MODEL_GPT5_5',
                '',
                '  MODEL_GPT5_6_LUNA  ',
            ]

            candidates.forEach(candidate => {
                const stored = normalizeThreadAssistantModelSelection(candidate)
                if (stored === null) return
                expect(getThreadAssistantModelOverride({ [THREAD_ASSISTANT_MODEL_FIELD]: stored })).toBe(stored)
            })
        })
    })

    describe('resolving the model a run uses', () => {
        it('uses the assistant model when the thread pins nothing', () => {
            expect(resolveThreadAssistantModel({ assistantModel: 'MODEL_GPT5_6_SOL' })).toEqual({
                model: 'MODEL_GPT5_6_SOL',
                source: 'assistant',
            })
        })

        it('uses the thread override when one is pinned', () => {
            expect(
                resolveThreadAssistantModel({
                    threadOverride: 'MODEL_GPT5_6_LUNA',
                    assistantModel: 'MODEL_GPT5_6_SOL',
                })
            ).toEqual({ model: 'MODEL_GPT5_6_LUNA', source: 'thread_override' })
        })

        // A pre-configured prompt was configured for its model deliberately; the conversation it
        // happens to be run from must not quietly re-point it.
        it('lets a model chosen for the work itself outrank the thread', () => {
            expect(
                resolveThreadAssistantModel({
                    explicitModel: 'MODEL_GPT5_6_TERRA',
                    threadOverride: 'MODEL_GPT5_6_LUNA',
                    assistantModel: 'MODEL_GPT5_6_SOL',
                })
            ).toEqual({ model: 'MODEL_GPT5_6_TERRA', source: 'explicit' })
        })

        it('falls through a retired thread override to the assistant', () => {
            expect(
                resolveThreadAssistantModel({
                    threadOverride: 'MODEL_GPT5_5',
                    assistantModel: 'MODEL_GPT5_6_SOL',
                })
            ).toEqual({ model: 'MODEL_GPT5_6_SOL', source: 'assistant' })
        })

        // Preserving the pre-AT-2502 behaviour exactly: with nothing pinned anywhere the caller
        // gets whatever it got before, including a null it then defaults itself.
        it('reports no model when nothing is configured anywhere', () => {
            expect(resolveThreadAssistantModel({})).toEqual({ model: null, source: 'assistant' })
            expect(resolveThreadAssistantModel()).toEqual({ model: null, source: 'assistant' })
        })
    })

    describe('the picker menu', () => {
        // The invariant is that every model picker in the app offers the same set — a model added
        // to the shared menu must reach the per-thread override too, or a user can pick it for an
        // assistant and then find it missing here.
        it('offers exactly the shared selectable models', () => {
            expect(THREAD_ASSISTANT_MODEL_OPTIONS.map(option => option.value)).toEqual(
                SELECTABLE_ASSISTANT_MODELS.map(option => option.model)
            )
            expect(THREAD_ASSISTANT_MODEL_OPTIONS.map(option => option.tokensPerGold)).toEqual(
                SELECTABLE_ASSISTANT_MODELS.map(option => option.tokensPerGold)
            )
            expect(THREAD_ASSISTANT_MODEL_OPTIONS.map(option => option.labelKey)).toEqual(
                SELECTABLE_ASSISTANT_MODELS.map(option => option.labelKey)
            )
        })

        it('names a model for the summary line, and nothing for an unknown one', () => {
            expect(getThreadAssistantModelName('MODEL_GPT5_6_SOL')).toBe('Sol')
            expect(getThreadAssistantModelName('MODEL_DEEPSEEK_V4_FLASH')).toBe('DeepSeek Flash')
            expect(getThreadAssistantModelName('MODEL_GPT5_5')).toBeNull()
            expect(getThreadAssistantModelName(undefined)).toBeNull()
        })
    })
})
