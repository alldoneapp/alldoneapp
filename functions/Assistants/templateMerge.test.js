const {
    getAssistantTemplateState,
    getTaskTemplateState,
    inheritMissingAssistantTemplateFields,
    isTaskUnmodified,
    mergeTemplateState,
    buildBackfillConflicts,
} = require('./templateMerge')

describe('templateMerge', () => {
    test('automatically applies untouched fields and reports locally changed fields', () => {
        const result = mergeTemplateState(
            { model: 'old', realtimeVoice: 'marin', mcpServers: [{ id: 'one' }] },
            { model: 'new', realtimeVoice: 'cedar', mcpServers: [{ id: 'two' }] },
            { model: 'old', realtimeVoice: 'alloy', mcpServers: [{ id: 'one' }] }
        )

        expect(result.patch).toEqual({ model: 'new', mcpServers: [{ id: 'two' }] })
        expect(result.conflicts).toEqual([
            expect.objectContaining({ field: 'realtimeVoice', localValue: 'alloy', templateValue: 'cedar' }),
        ])
    })

    test('propagates deletion only when the local field was untouched', () => {
        const result = mergeTemplateState(
            { prompt: 'old', description: 'base' },
            {},
            {
                prompt: 'old',
                description: 'local',
            }
        )

        expect(result.deleteFields).toEqual(['prompt'])
        expect(result.conflicts).toEqual([
            expect.objectContaining({ field: 'description', templateValueExists: false }),
        ])
    })

    test('excludes identity and local assistant metadata but includes new settings automatically', () => {
        expect(
            getAssistantTemplateState({
                uid: 'template',
                creatorId: 'admin',
                isDefault: true,
                templateSyncConflicts: [],
                realtimeVoice: 'cedar',
                mcpServers: [{ id: 'server' }],
            })
        ).toEqual({ realtimeVoice: 'cedar', mcpServers: [{ id: 'server' }] })
    })

    test('preserves execution state and recurring schedule times in task comparisons', () => {
        const template = {
            title: 'Run',
            recurrence: 'daily',
            startTime: 8,
            lastExecuted: 1,
            aiModel: 'MODEL_GPT5_5',
            aiModelOverride: 'MODEL_GPT5_6_TERRA',
        }
        const local = {
            title: 'Run',
            recurrence: 'daily',
            startTime: 12,
            lastExecuted: 999,
            activatedUserIds: ['user'],
            aiModel: 'MODEL_GPT5_6_SOL',
            aiModelOverride: 'MODEL_GPT5_6_TERRA',
        }
        expect(getTaskTemplateState(local)).toEqual({
            title: 'Run',
            recurrence: 'daily',
            aiModelOverride: 'MODEL_GPT5_6_TERRA',
        })
        expect(isTaskUnmodified(template, local)).toBe(true)
    })

    test('backfill conservatively asks for review instead of overwriting historical differences', () => {
        expect(buildBackfillConflicts({ model: 'new', temperature: 1 }, { model: 'local', temperature: 1 })).toEqual([
            expect.objectContaining({
                field: 'model',
                localValue: 'local',
                templateValue: 'new',
                previousTemplateValueExists: false,
            }),
        ])
    })

    test('treats a missing legacy heartbeat model as the previous template value', () => {
        const previousTemplate = { heartbeatModel: 'terra' }
        const currentTemplate = { heartbeatModel: 'luna' }
        const { normalizedLocalState } = inheritMissingAssistantTemplateFields({}, previousTemplate)

        expect(mergeTemplateState(previousTemplate, currentTemplate, normalizedLocalState)).toEqual({
            patch: { heartbeatModel: 'luna' },
            deleteFields: [],
            conflicts: [],
        })
    })

    test('preserves an explicit local heartbeat model as a genuine override', () => {
        const previousTemplate = { heartbeatModel: 'terra' }
        const currentTemplate = { heartbeatModel: 'luna' }
        const { normalizedLocalState } = inheritMissingAssistantTemplateFields(
            { heartbeatModel: 'sol' },
            previousTemplate
        )
        const result = mergeTemplateState(previousTemplate, currentTemplate, normalizedLocalState)

        expect(result.patch).toEqual({})
        expect(result.conflicts).toEqual([
            expect.objectContaining({ field: 'heartbeatModel', localValue: 'sol', templateValue: 'luna' }),
        ])
    })

    test('backfill inherits a missing heartbeat model without suppressing other conflicts', () => {
        const template = { heartbeatModel: 'terra', model: 'new' }
        const { normalizedLocalState, inheritedPatch } = inheritMissingAssistantTemplateFields(
            { model: 'local' },
            template
        )

        expect(inheritedPatch).toEqual({ heartbeatModel: 'terra' })
        expect(buildBackfillConflicts(template, normalizedLocalState)).toEqual([
            expect.objectContaining({ field: 'model', localValue: 'local', templateValue: 'new' }),
        ])
    })

    test('propagates reasoning effort while preserving a genuine local override', () => {
        const previousTemplate = { reasoningEffort: null }
        const currentTemplate = { reasoningEffort: 'high' }
        const inherited = inheritMissingAssistantTemplateFields({}, previousTemplate)

        expect(mergeTemplateState(previousTemplate, currentTemplate, inherited.normalizedLocalState)).toEqual({
            patch: { reasoningEffort: 'high' },
            deleteFields: [],
            conflicts: [],
        })
        expect(mergeTemplateState(previousTemplate, currentTemplate, { reasoningEffort: 'low' }).conflicts).toEqual([
            expect.objectContaining({ field: 'reasoningEffort', localValue: 'low', templateValue: 'high' }),
        ])
    })
})
