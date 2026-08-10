const {
    DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
    buildProjectDefinitionsFromProjects,
    normalizeCalendarProjectRoutingConfig,
    sanitizeCalendarProjectRoutingConfigForSave,
} = require('./CalendarProjectRoutingSettings.helpers')

describe('CalendarProjectRoutingSettings helpers', () => {
    test('defaults routing to disabled with the default prompt', () => {
        const config = normalizeCalendarProjectRoutingConfig('project-1', {}, 'person@example.com')

        expect(config.enabled).toBe(false)
        expect(config.prompt).toBe(DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT)
        expect(config.model).toBe('MODEL_GPT5_4_NANO')
        expect(config.calendarEmail).toBe('person@example.com')
    })

    test('sanitizes config for save', () => {
        const config = sanitizeCalendarProjectRoutingConfigForSave({
            enabled: true,
            calendarEmail: 'person@example.com',
            prompt: 'Route events',
            confidenceThreshold: '2',
        })

        expect(config.enabled).toBe(true)
        expect(config.confidenceThreshold).toBe(1)
        expect(config.model).toBe('MODEL_GPT5_4_NANO')
    })

    test('builds active project context and removes project description prefix', () => {
        const definitions = buildProjectDefinitionsFromProjects([
            { id: 'project-a', name: 'Alldone Product', description: 'Project Description: Product work' },
            { id: 'private', name: 'Private Project', description: '' },
            { id: 'inactive', name: 'Inactive', active: false },
        ])

        expect(definitions.map(project => project.name)).toEqual(['Alldone Product', 'Private Project'])
        expect(definitions[0].description).toBe('Product work')
        expect(definitions[0].routingDescription).toContain('Alldone Product')
        expect(definitions[0].routingDescription).toContain('Product work')
    })
})
