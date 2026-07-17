const {
    getAssistantTemplateState,
    getTaskTemplateState,
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
        const template = { title: 'Run', recurrence: 'daily', startTime: 8, lastExecuted: 1 }
        const local = {
            title: 'Run',
            recurrence: 'daily',
            startTime: 12,
            lastExecuted: 999,
            activatedUserIds: ['user'],
        }
        expect(getTaskTemplateState(local)).toEqual({ title: 'Run', recurrence: 'daily' })
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
})
