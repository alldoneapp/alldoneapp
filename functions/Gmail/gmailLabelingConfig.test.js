const {
    DEFAULT_SYNC_INTERVAL_MINUTES,
    GMAIL_LABELING_PROMPT_MODE_CUSTOM,
    GMAIL_LABELING_PROMPT_MODE_DEFAULT,
    findLabelIdByName,
    normalizeConfigInput,
    normalizeLabelDefinition,
    validateGmailLabelingConfig,
} = require('./gmailLabelingConfig')

describe('gmailLabelingConfig', () => {
    test('defaults Gmail labeling to GPT-5.4 nano', () => {
        const config = normalizeConfigInput('project-1', {})

        expect(config.model).toBe('MODEL_GPT5_4_NANO')
    })

    test('defaults Gmail labeling sync interval to 30 minutes', () => {
        const config = normalizeConfigInput('project-1', {})

        expect(DEFAULT_SYNC_INTERVAL_MINUTES).toBe(30)
        expect(config.syncIntervalMinutes).toBe(30)
    })

    test('defaults account-wide labeled email auto-archive to off', () => {
        expect(normalizeConfigInput('project-1', {}).autoArchiveAllLabeled).toBe(false)
        expect(normalizeConfigInput('project-1', { autoArchiveAllLabeled: true }).autoArchiveAllLabeled).toBe(true)
    })

    test('defaults new Gmail labeling configs to default prompt mode', () => {
        const config = normalizeConfigInput('project-1', {})

        expect(config.promptMode).toBe(GMAIL_LABELING_PROMPT_MODE_DEFAULT)
    })

    test('default custom prompt explains threshold confidence semantics', () => {
        const config = normalizeConfigInput('project-1', {})

        expect(config.prompt).toContain('configured confidence threshold')
        expect(config.prompt).toContain('Confidence for a match means confidence in the selected label')
        expect(config.prompt).toContain('use the default project as the label')
        expect(config.prompt).toContain('Do not use matched:false')
    })

    test('normalizes valid prompt modes', () => {
        expect(normalizeConfigInput('project-1', { promptMode: 'custom' }).promptMode).toBe(
            GMAIL_LABELING_PROMPT_MODE_CUSTOM
        )
        expect(normalizeConfigInput('project-1', { promptMode: 'default' }).promptMode).toBe(
            GMAIL_LABELING_PROMPT_MODE_DEFAULT
        )
    })

    test('normalizes postLabelPrompt on label definitions', () => {
        expect(
            normalizeLabelDefinition({
                key: 'client_followup',
                gmailLabelName: 'Alldone/Client',
                description: 'Important client emails',
                directionScope: 'BOTH',
                autoArchive: false,
                postLabelPrompt: '  create a task for this email  ',
            })
        ).toEqual({
            key: 'client_followup',
            gmailLabelName: 'Alldone/Client',
            description: 'Important client emails',
            directionScope: 'both',
            autoArchive: false,
            postLabelPrompt: 'create a task for this email',
        })
    })

    test('preserves postLabelPrompt through config normalization', () => {
        const config = normalizeConfigInput('project-1', {
            labelDefinitions: [
                {
                    gmailLabelName: 'Alldone/Urgent',
                    description: 'Urgent emails',
                    postLabelPrompt: '  create_task based on this email  ',
                },
            ],
        })

        expect(config.labelDefinitions).toHaveLength(1)
        expect(config.labelDefinitions[0].postLabelPrompt).toBe('create_task based on this email')
    })

    test('defaults invalid directionScope to incoming', () => {
        const config = normalizeConfigInput('project-1', {
            labelDefinitions: [
                {
                    gmailLabelName: 'Alldone/Urgent',
                    description: 'Urgent emails',
                    directionScope: 'sideways',
                },
            ],
        })

        expect(config.labelDefinitions[0].directionScope).toBe('incoming')
    })

    test('stores whitespace-only postLabelPrompt as empty string', () => {
        const config = normalizeConfigInput('project-1', {
            labelDefinitions: [
                {
                    gmailLabelName: 'Alldone/Urgent',
                    description: 'Urgent emails',
                    postLabelPrompt: '   ',
                },
            ],
        })

        expect(config.labelDefinitions[0].postLabelPrompt).toBe('')
    })

    test('allows default mode without custom prompt or rules', () => {
        const validation = validateGmailLabelingConfig({
            enabled: true,
            projectId: 'project-1',
            promptMode: GMAIL_LABELING_PROMPT_MODE_DEFAULT,
            prompt: '',
            labelDefinitions: [],
        })

        expect(validation.valid).toBe(true)
    })

    test('requires prompt and rules in custom mode', () => {
        const validation = validateGmailLabelingConfig({
            enabled: true,
            projectId: 'project-1',
            promptMode: GMAIL_LABELING_PROMPT_MODE_CUSTOM,
            prompt: '',
            labelDefinitions: [],
        })

        expect(validation.valid).toBe(false)
        expect(validation.errors.join(' ')).toContain('Prompt is required')
        expect(validation.errors.join(' ')).toContain('At least one label definition')
    })

    describe('findLabelIdByName', () => {
        test('prefers an exact-case match', () => {
            const map = new Map([
                ['Ads', 'Label_ads'],
                ['ads', 'Label_lower'],
            ])

            expect(findLabelIdByName(map, 'Ads')).toBe('Label_ads')
            expect(findLabelIdByName(map, 'ads')).toBe('Label_lower')
        })

        test('falls back to a case-insensitive match so case variants reuse one label', () => {
            const map = new Map([['Ads', 'Label_ads']])

            expect(findLabelIdByName(map, 'ads')).toBe('Label_ads')
            expect(findLabelIdByName(map, 'ADS')).toBe('Label_ads')
            expect(findLabelIdByName(map, '  ads  ')).toBe('Label_ads')
        })

        test('returns null for empty, unknown, or invalid inputs', () => {
            const map = new Map([['Ads', 'Label_ads']])

            expect(findLabelIdByName(map, 'Receipts')).toBeNull()
            expect(findLabelIdByName(map, '')).toBeNull()
            expect(findLabelIdByName(map, '   ')).toBeNull()
            expect(findLabelIdByName(null, 'Ads')).toBeNull()
        })
    })
})
