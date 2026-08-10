jest.mock('firebase-admin', () => ({
    firestore: Object.assign(
        jest.fn(() => ({})),
        {
            Timestamp: {
                now: jest.fn(() => 'timestamp-now'),
            },
        }
    ),
}))

const {
    DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
    buildCalendarProjectDefinitions,
    cleanProjectDescription,
    normalizeCalendarProjectRoutingConfigInput,
    validateCalendarProjectRoutingConfig,
} = require('./calendarProjectRoutingConfig')
const { DEFAULT_GMAIL_LABELING_MODEL } = require('../Gmail/gmailLabelingConfig')

describe('calendarProjectRoutingConfig', () => {
    test('defaults routing to disabled and the shared Gmail labeling model', () => {
        const config = normalizeCalendarProjectRoutingConfigInput('project-1', {}, 'person@example.com')

        expect(config.enabled).toBe(false)
        expect(config.model).toBe(DEFAULT_GMAIL_LABELING_MODEL)
        expect(config.prompt).toBe(DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT)
        expect(config.calendarEmail).toBe('person@example.com')
    })

    test('normalizes a stored GPT-5.6 Luna first pass to the shared default model', () => {
        // Luna was once a temporary first-pass override; stored configs carrying it
        // follow the shared default wherever it moves (currently Luna itself).
        const config = normalizeCalendarProjectRoutingConfigInput('project-1', {
            model: 'MODEL_GPT5_6_LUNA',
        })

        expect(config.model).toBe(DEFAULT_GMAIL_LABELING_MODEL)
    })

    test('normalizes confidence threshold and trims prompt', () => {
        const config = normalizeCalendarProjectRoutingConfigInput('project-1', {
            enabled: true,
            prompt: '  Route events precisely  ',
            confidenceThreshold: 2,
        })

        expect(config.prompt).toBe('Route events precisely')
        expect(config.confidenceThreshold).toBe(1)
    })

    test('requires a prompt when enabled', () => {
        const validation = validateCalendarProjectRoutingConfig({
            enabled: true,
            projectId: 'project-1',
            prompt: '',
        })

        expect(validation.valid).toBe(false)
        expect(validation.errors.join(' ')).toContain('Prompt is required')
    })

    test('builds active project definitions with cleaned descriptions', () => {
        const definitions = buildCalendarProjectDefinitions([
            { id: 'project-a', name: 'Alldone Product', description: 'Project Description: Roadmap work' },
            { id: 'project-b', name: 'Private Project', description: '' },
            { id: 'archived', name: 'Archived', active: false },
            { id: 'template', name: 'Template', isTemplate: true },
            { id: 'guide', name: 'Guide', parentTemplateId: 'template-1' },
        ])

        expect(definitions.map(project => project.projectId)).toEqual(['project-a', 'project-b'])
        expect(definitions[0].description).toBe('Roadmap work')
        expect(definitions[0].routingDescription).toContain('Alldone Product')
        expect(definitions[0].routingDescription).toContain('Roadmap work')
    })

    test('cleans project description prefix case-insensitively', () => {
        expect(cleanProjectDescription('project description: Client work')).toBe('Client work')
    })
})
