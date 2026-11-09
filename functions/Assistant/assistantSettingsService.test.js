const { createFakeFirestore } = require('../Tests/fakeFirestore')
const {
    MAX_ASSISTANT_PROMPT_HISTORY,
    buildAssistantSettingsPatch,
    commitAssistantSettings,
    propagateInstructionsToScheduledTasks,
} = require('./assistantSettingsService')

const P = 'p1'
const A = 'a1'

describe('assistant settings: one service for update_assistant_settings and MCP update_assistant', () => {
    test('validates the fields and leaves out values equal to the stored ones', () => {
        const current = { displayName: 'Growth Lead', model: 'MODEL_GPT6_SOL', temperature: 'TEMPERATURE_NORMAL' }
        expect(
            buildAssistantSettingsPatch(current, {
                displayName: ' Growth Lead ',
                model: 'MODEL_GPT6_SOL',
                temperature: 'TEMPERATURE_LOW',
                realtimeVoice: 'marin',
            })
        ).toEqual({
            patch: { temperature: 'TEMPERATURE_LOW', realtimeVoice: 'marin' },
            updatedFields: ['temperature', 'realtimeVoice'],
        })
        expect(() => buildAssistantSettingsPatch(current, { model: 'MODEL_UNKNOWN' })).toThrow(/model must be one of/)
        expect(() => buildAssistantSettingsPatch(current, { instructions: '  ' })).toThrow(/non-empty/)
        expect(() => buildAssistantSettingsPatch(current, { realtimeVoice: 'robot' })).toThrow(/realtimeVoice/)
    })

    test('keeps the replaced instructions in the history, newest first, capped', async () => {
        const history = Array.from({ length: MAX_ASSISTANT_PROMPT_HISTORY }, (_, index) => ({
            prompt: `old ${index}`,
            instructions: `old ${index}`,
        }))
        const db = createFakeFirestore({
            [`assistants/${P}/items/${A}`]: { instructions: 'Current', instructionsHistory: history },
        })
        const result = await commitAssistantSettings({
            db,
            ref: db.doc(`assistants/${P}/items/${A}`),
            patch: { instructions: 'Next' },
            extraUpdate: { lastEditorId: 'karsten' },
            requestUserId: 'karsten',
            actorAssistantId: A,
            now: 1,
        })
        const stored = db.docs.get(`assistants/${P}/items/${A}`)
        expect(stored.instructions).toBe('Next')
        expect(stored.lastEditorId).toBe('karsten')
        expect(stored.instructionsHistory).toHaveLength(MAX_ASSISTANT_PROMPT_HISTORY)
        expect(stored.instructionsHistory[0]).toMatchObject({ instructions: 'Current', replacedByAssistantId: A })
        expect(result).toEqual({ historyLength: MAX_ASSISTANT_PROMPT_HISTORY, previousInstructions: 'Current' })
    })

    test('changed instructions reach only scheduled tasks still on an unchanged copy', async () => {
        const db = createFakeFirestore({
            [`assistantTasks/${P}/${A}/t1`]: { aiSystemMessage: 'Old' },
            [`assistantTasks/${P}/${A}/t2`]: { aiSystemMessage: 'Edited by somebody' },
        })
        const count = await propagateInstructionsToScheduledTasks({
            db,
            projectId: P,
            assistantId: A,
            previousInstructions: 'Old',
            nextInstructions: 'New',
        })
        expect(count).toBe(1)
        expect(db.docs.get(`assistantTasks/${P}/${A}/t1`).aiSystemMessage).toBe('New')
        expect(db.docs.get(`assistantTasks/${P}/${A}/t2`).aiSystemMessage).toBe('Edited by somebody')
    })
})
