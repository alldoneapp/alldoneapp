const { normalizeConfigInput, normalizeLabelDefinition } = require('./gmailLabelingConfig')

describe('gmailLabelingConfig', () => {
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
})
