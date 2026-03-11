const {
    createEmptyLabel,
    formatPostLabelActionStatus,
    normalizeConfig,
    sanitizeConfigForSave,
} = require('./GmailLabelingSettings.helpers')

describe('GmailLabelingSettings helpers', () => {
    test('creates an empty rule with postLabelPrompt', () => {
        expect(createEmptyLabel(0)).toEqual(
            expect.objectContaining({
                gmailLabelName: '',
                description: '',
                autoArchive: false,
                postLabelPrompt: '',
            })
        )
    })

    test('normalizes and sanitizes rule postLabelPrompt values', () => {
        const normalized = normalizeConfig(
            'project-1',
            {
                labelDefinitions: [
                    {
                        gmailLabelName: 'Alldone/Urgent',
                        description: 'Urgent emails',
                        postLabelPrompt: 'Create a task with this email link',
                    },
                ],
            },
            'person@example.com'
        )

        const sanitized = sanitizeConfigForSave(normalized)

        expect(sanitized.labelDefinitions[0].postLabelPrompt).toBe('Create a task with this email link')
    })

    test('formats follow-up action statuses for audit display', () => {
        expect(formatPostLabelActionStatus({ status: 'completed' })).toBe('Completed')
        expect(formatPostLabelActionStatus({ status: 'blocked' })).toBe('Blocked')
        expect(formatPostLabelActionStatus({ status: 'failed' })).toBe('Failed')
    })
})
