jest.mock('../../../../i18n/TranslationService', () => ({
    translate: key => key,
}))

jest.mock('../../../../utils/backends/Assistants/assistantsFirestore', () => ({
    resolveAssistantTemplateConflicts: jest.fn(),
}))

jest.mock('../../../UIControls/Button', () => () => null)

const { formatTemplateConflictField, formatTemplateConflictValue } = require('./UpdateFromTemplate')

describe('UpdateFromTemplate formatting', () => {
    test('shows friendly labels for known and generic assistant fields', () => {
        expect(formatTemplateConflictField('heartbeatModel')).toBe('Heartbeat model')
        expect(formatTemplateConflictField('emailModel')).toBe('Inbound email model')
        expect(formatTemplateConflictField('reasoningEffort')).toBe('Reasoning effort')
        expect(formatTemplateConflictField('heartbeatReasoningEffort')).toBe('Heartbeat reasoning effort')
        expect(formatTemplateConflictField('heartbeatAwakeStart')).toBe('Heartbeat Awake Start')
    })

    test('shows readable model names instead of internal constants', () => {
        expect(formatTemplateConflictValue('heartbeatModel', 'MODEL_GPT5_6_TERRA', true)).toBe('GPT 5.6 Terra')
        expect(formatTemplateConflictValue('model', 'MODEL_GPT5_6_LUNA', true)).toBe('GPT 5.6 Luna')
        expect(formatTemplateConflictValue('emailModel', 'MODEL_GPT5_6_SOL', true)).toBe('GPT 5.6 Sol')
    })

    test('preserves the existing removed-value label', () => {
        expect(formatTemplateConflictValue('heartbeatModel', null, false)).toBe('(removed)')
    })

    test('shows reasoning effort values including model default', () => {
        expect(formatTemplateConflictValue('reasoningEffort', 'none', true)).toBe('None')
        expect(formatTemplateConflictValue('reasoningEffort', 'high', true)).toBe('High')
        expect(formatTemplateConflictValue('reasoningEffort', 'xhigh', true)).toBe('XHigh')
        expect(formatTemplateConflictValue('reasoningEffort', 'max', true)).toBe('Max')
        expect(formatTemplateConflictValue('reasoningEffort', null, true)).toBe('Model default')
        expect(formatTemplateConflictValue('heartbeatReasoningEffort', 'medium', true)).toBe('Medium')
    })
})
