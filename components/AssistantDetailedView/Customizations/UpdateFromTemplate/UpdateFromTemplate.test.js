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
        expect(formatTemplateConflictField('heartbeatAwakeStart')).toBe('Heartbeat Awake Start')
    })

    test('shows readable model names instead of internal constants', () => {
        expect(formatTemplateConflictValue('heartbeatModel', 'MODEL_GPT5_6_TERRA', true)).toBe('GPT 5.6 Terra')
        expect(formatTemplateConflictValue('model', 'MODEL_GPT5_6_LUNA', true)).toBe('GPT 5.6 Luna')
    })

    test('preserves the existing removed-value label', () => {
        expect(formatTemplateConflictValue('heartbeatModel', null, false)).toBe('(removed)')
    })
})
