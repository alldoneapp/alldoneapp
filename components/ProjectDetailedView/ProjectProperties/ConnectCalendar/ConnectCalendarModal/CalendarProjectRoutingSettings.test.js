const {
    DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
    buildProjectDefinitionsFromProjects,
    normalizeCalendarProjectRoutingConfig,
    normalizeCalendarRoutingModel,
    sanitizeCalendarProjectRoutingConfigForSave,
} = require('./CalendarProjectRoutingSettings.helpers')
const { SELECTABLE_ASSISTANT_MODELS } = require('../../../../../functions/Assistant/selectableAssistantModels')

describe('CalendarProjectRoutingSettings helpers', () => {
    test('defaults routing to disabled with the default prompt', () => {
        const config = normalizeCalendarProjectRoutingConfig('project-1', {}, 'person@example.com')

        expect(config.enabled).toBe(false)
        expect(config.prompt).toBe(DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT)
        // Was 'MODEL_GPT5_4_NANO' — a key outside the selectable set that the server's key→model
        // mapper did not know, so it fell through to `gpt-5.2`. Calendar routing therefore ran on a
        // model nobody had chosen. The default is now the shared low-cost model, which the server
        // recognises, so the stored value and the model actually invoked agree.
        expect(config.model).toBe('MODEL_GPT5_6_LUNA')
        expect(config.calendarEmail).toBe('person@example.com')
        expect(config.learnedRules).toBe('')
        expect(config.learnedRulesRevision).toBe(0)
        expect(config.learnedGoalRules).toBe('')
        expect(config.learnedGoalRulesRevision).toBe(0)
    })

    test('sanitizes config for save', () => {
        const config = sanitizeCalendarProjectRoutingConfigForSave({
            enabled: true,
            calendarEmail: 'person@example.com',
            prompt: 'Route events',
            learnedRules: '  - Acme weekly routes to Acme  ',
            learnedRulesRevision: 4,
            learnedGoalRules: '  - Acme weekly goes to Client delivery  ',
            learnedGoalRulesRevision: 2,
            confidenceThreshold: '2',
        })

        expect(config.enabled).toBe(true)
        expect(config.confidenceThreshold).toBe(1)
        expect(config.model).toBe('MODEL_GPT5_6_LUNA')
        expect(config.learnedRules).toBe('- Acme weekly routes to Acme')
        expect(config.learnedRulesRevision).toBe(4)
        expect(config.learnedGoalRules).toBe('- Acme weekly goes to Client delivery')
        expect(config.learnedGoalRulesRevision).toBe(2)
    })

    test('keeps a selectable model choice, including the OpenRouter-served one', () => {
        expect(normalizeCalendarRoutingModel('MODEL_DEEPSEEK_V4_FLASH')).toBe('MODEL_DEEPSEEK_V4_FLASH')
        expect(sanitizeCalendarProjectRoutingConfigForSave({ model: 'MODEL_DEEPSEEK_V4_FLASH' }).model).toBe(
            'MODEL_DEEPSEEK_V4_FLASH'
        )

        SELECTABLE_ASSISTANT_MODELS.forEach(option => {
            expect(normalizeCalendarRoutingModel(option.model)).toBe(option.model)
        })
    })

    test('coerces an unselectable or missing model to the default rather than passing it through', () => {
        // The pass-through was the bug: an unknown key reached the server, missed every mapper
        // branch and silently became `gpt-5.2`.
        expect(normalizeCalendarRoutingModel('MODEL_GPT5_4_NANO')).toBe('MODEL_GPT5_6_LUNA')
        expect(normalizeCalendarRoutingModel('nonsense')).toBe('MODEL_GPT5_6_LUNA')
        expect(normalizeCalendarRoutingModel(undefined)).toBe('MODEL_GPT5_6_LUNA')
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
