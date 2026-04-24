const {
    DEFAULT_CUSTOM_GMAIL_LABELING_PROMPT,
    GMAIL_LABELING_PROMPT_MODE_CUSTOM,
    GMAIL_LABELING_PROMPT_MODE_DEFAULT,
    STARTER_CUSTOM_LABEL_DEFINITIONS,
    buildCustomDefaultsForReset,
    buildDefaultConfigPreviewFromProjects,
    buildDefaultProjectFollowUpPrompt,
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

        expect(normalized.model).toBe('MODEL_GPT5_4_NANO')
        expect(sanitized.model).toBe('MODEL_GPT5_4_NANO')
        expect(sanitized.labelDefinitions[0].postLabelPrompt).toBe('Create a task with this email link')
    })

    test('defaults new configs to default prompt mode', () => {
        expect(normalizeConfig('project-1').promptMode).toBe(GMAIL_LABELING_PROMPT_MODE_DEFAULT)
    })

    test('treats legacy saved configs as custom prompt mode', () => {
        const normalized = normalizeConfig('project-1', {
            prompt: 'Legacy custom prompt',
            labelDefinitions: [{ gmailLabelName: 'Client', description: 'Client work' }],
        })

        expect(normalized.promptMode).toBe(GMAIL_LABELING_PROMPT_MODE_CUSTOM)
    })

    test('preserves custom prompt and rules when saving default mode', () => {
        const sanitized = sanitizeConfigForSave({
            enabled: true,
            gmailEmail: 'person@example.com',
            promptMode: GMAIL_LABELING_PROMPT_MODE_DEFAULT,
            prompt: 'Keep this custom prompt',
            model: 'MODEL_GPT5_4_NANO',
            processUnreadOnly: true,
            onlyInbox: true,
            lookbackDays: '7',
            syncIntervalMinutes: '5',
            maxMessagesPerRun: '20',
            confidenceThreshold: '0.7',
            labelDefinitions: [
                {
                    id: 'local-id',
                    key: 'client',
                    gmailLabelName: 'Client',
                    description: 'Client work',
                    postLabelPrompt: 'Create a follow-up task',
                },
            ],
        })

        expect(sanitized.promptMode).toBe(GMAIL_LABELING_PROMPT_MODE_DEFAULT)
        expect(sanitized.prompt).toBe('Keep this custom prompt')
        expect(sanitized.labelDefinitions[0].postLabelPrompt).toBe('Create a follow-up task')
    })

    test('builds editable custom defaults for reset', () => {
        const customDefaults = buildCustomDefaultsForReset()

        expect(customDefaults.prompt).toBe(DEFAULT_CUSTOM_GMAIL_LABELING_PROMPT)
        expect(customDefaults.labelDefinitions).toHaveLength(STARTER_CUSTOM_LABEL_DEFINITIONS.length)
        expect(customDefaults.labelDefinitions[0]).toEqual(
            expect.objectContaining({
                key: 'newsletter',
                gmailLabelName: 'Alldone/Newsletter',
                autoArchive: true,
                postLabelPrompt: '',
            })
        )
        expect(customDefaults.labelDefinitions[0].id).toContain('custom-default-')
    })

    test('builds default project label preview with duplicate names suffixed and follow-ups', () => {
        const preview = buildDefaultConfigPreviewFromProjects([
            { id: 'project-a', name: 'Client', description: 'Project Description: Website launch' },
            { id: 'project-b', name: 'Client', description: '' },
            { id: 'archived', name: 'Archived', active: false },
        ])

        expect(preview.prompt).toContain('active Alldone project')
        expect(preview.labelDefinitions.map(label => label.gmailLabelName)).toEqual(['Client', 'Client (2)'])
        expect(preview.labelDefinitions[0].description).toContain('Website launch')
        expect(preview.labelDefinitions[0].description).not.toContain('Project description: Project Description')
        expect(preview.labelDefinitions[1].autoArchive).toBe(false)
        expect(preview.labelDefinitions[1].postLabelPrompt).toContain('Only if its an inbound email')
        expect(preview.labelDefinitions[1].postLabelPrompt).toContain('update_note')
        expect(preview.labelDefinitions[1].postLabelPrompt).toContain('Client (2)')
        expect(preview.labelDefinitions[1].postLabelPromptDirectionScope).toBe('incoming')
    })

    test('builds default project follow-up prompt with the label name', () => {
        const prompt = buildDefaultProjectFollowUpPrompt('Alldone Product')

        expect(prompt).toContain('project Alldone Product')
        expect(prompt).toContain('hello@cal.com')
        expect(prompt).toContain('with a space at the end')
    })

    test('formats follow-up action statuses for audit display', () => {
        expect(formatPostLabelActionStatus({ status: 'completed' })).toBe('Completed')
        expect(formatPostLabelActionStatus({ status: 'blocked' })).toBe('Blocked')
        expect(formatPostLabelActionStatus({ status: 'failed' })).toBe('Failed')
    })
})
