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
    appendCalendarGoalLearnedRulesToPrompt,
    appendCalendarLearnedRulesToPrompt,
    buildCalendarGoalSeriesRouteKey,
    buildCalendarProjectRoutingConfigWriteData,
    buildCalendarSeriesRouteKey,
    buildCalendarProjectDefinitions,
    cleanProjectDescription,
    findLearnedCalendarGoalSeriesRoute,
    findLearnedCalendarSeriesRoute,
    normalizeCalendarProjectRoutingConfigInput,
    validateCalendarProjectRoutingConfig,
} = require('./calendarProjectRoutingConfig')
const { DEFAULT_GMAIL_LABELING_MODEL } = require('../Gmail/gmailLabelingConfig')
const { SELECTABLE_ASSISTANT_MODELS } = require('../Assistant/selectableAssistantModels')

describe('calendarProjectRoutingConfig', () => {
    test('defaults routing to disabled and the shared Gmail labeling model', () => {
        const config = normalizeCalendarProjectRoutingConfigInput('project-1', {}, 'person@example.com')

        expect(config.enabled).toBe(false)
        expect(config.model).toBe(DEFAULT_GMAIL_LABELING_MODEL)
        expect(config.prompt).toBe(DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT)
        expect(config.calendarEmail).toBe('person@example.com')
        expect(config.learnedRules).toBe('')
        expect(config.learnedSeriesRoutes).toEqual({})
        expect(config.learnedGoalRules).toBe('')
        expect(config.learnedGoalSeriesRoutes).toEqual({})
    })

    test('normalizes a stored GPT-5.6 Luna first pass to the shared default model', () => {
        // Luna was once a temporary first-pass override; stored configs carrying it
        // follow the shared default wherever it moves (currently Luna itself).
        const config = normalizeCalendarProjectRoutingConfigInput('project-1', {
            model: 'MODEL_GPT5_6_LUNA',
        })

        expect(config.model).toBe(DEFAULT_GMAIL_LABELING_MODEL)
    })

    test('keeps any model the user can actually select, including the OpenRouter-served one', () => {
        SELECTABLE_ASSISTANT_MODELS.forEach(option => {
            expect(normalizeCalendarProjectRoutingConfigInput('project-1', { model: option.model }).model).toBe(
                option.model
            )
        })
        expect(
            normalizeCalendarProjectRoutingConfigInput('project-1', { model: 'MODEL_DEEPSEEK_V4_FLASH' }).model
        ).toBe('MODEL_DEEPSEEK_V4_FLASH')
    })

    test('coerces an unselectable model to the default instead of passing it through', () => {
        // This field used to accept any string. An unknown key then missed every branch of the
        // classifier's key→model mapper and silently resolved to `gpt-5.2`, so calendar routing ran
        // on a model that was neither stored nor chosen. Gmail labeling has always validated here;
        // calendar now matches it.
        expect(normalizeCalendarProjectRoutingConfigInput('project-1', { model: 'MODEL_GPT5_4_NANO' }).model).toBe(
            DEFAULT_GMAIL_LABELING_MODEL
        )
        expect(normalizeCalendarProjectRoutingConfigInput('project-1', { model: 'gpt-4o' }).model).toBe(
            DEFAULT_GMAIL_LABELING_MODEL
        )
        expect(normalizeCalendarProjectRoutingConfigInput('project-1', { model: '   ' }).model).toBe(
            DEFAULT_GMAIL_LABELING_MODEL
        )
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

    test('appends learned feedback rules to the effective classifier prompt', () => {
        expect(appendCalendarLearnedRulesToPrompt('Route events', '- Acme weekly goes to Acme')).toBe(
            'Route events\n\nUser routing feedback rules (always apply):\n- Acme weekly goes to Acme'
        )
        expect(appendCalendarGoalLearnedRulesToPrompt('Choose a Goal', '- Weekly status goes to Delivery')).toBe(
            'Choose a Goal\n\nUser calendar-to-Goal feedback rules (always apply):\n- Weekly status goes to Delivery'
        )
    })

    test('preserves learned rules and recurring-series routes across partial settings saves', () => {
        const seriesKey = buildCalendarSeriesRouteKey('google', 'series-1')
        const goalSeriesKey = buildCalendarGoalSeriesRouteKey('google', 'series-1', 'project-a')
        const result = buildCalendarProjectRoutingConfigWriteData(
            'user-1',
            'calendar-project',
            { enabled: true, prompt: 'Updated prompt' },
            'me@example.com',
            {
                learnedRules: '- Keep this rule',
                learnedRulesRevision: 4,
                learnedSeriesRoutes: {
                    [seriesKey]: {
                        recurringEventId: 'series-1',
                        provider: 'google',
                        targetProjectId: 'project-a',
                        learnedAt: 123,
                    },
                },
                learnedGoalRules: '- Keep this Goal rule',
                learnedGoalRulesRevision: 2,
                learnedGoalSeriesRoutes: {
                    [goalSeriesKey]: {
                        recurringEventId: 'series-1',
                        provider: 'google',
                        projectId: 'project-a',
                        targetGoalId: 'goal-a',
                        learnedAt: 124,
                    },
                },
            }
        )

        expect(result.learnedRules).toBe('- Keep this rule')
        expect(result.learnedRulesRevision).toBe(4)
        expect(result.learnedSeriesRoutes[seriesKey]).toEqual(
            expect.objectContaining({ targetProjectId: 'project-a', recurringEventId: 'series-1' })
        )
        expect(result.learnedGoalRules).toBe('- Keep this Goal rule')
        expect(result.learnedGoalRulesRevision).toBe(2)
        expect(result.learnedGoalSeriesRoutes[goalSeriesKey]).toEqual(
            expect.objectContaining({ projectId: 'project-a', targetGoalId: 'goal-a' })
        )
    })

    test('rejects a stale learned-rules edit instead of overwriting newer move feedback', () => {
        expect(() =>
            buildCalendarProjectRoutingConfigWriteData(
                'user-1',
                'calendar-project',
                {
                    enabled: true,
                    prompt: 'Route events',
                    learnedRules: '- Stale rules from the open settings modal',
                    learnedRulesRevision: 2,
                },
                'me@example.com',
                {
                    learnedRules: '- New rule learned from a calendar move',
                    learnedRulesRevision: 3,
                    learnedSeriesRoutes: {},
                }
            )
        ).toThrow('learned rules changed while settings were open')
    })

    test('rejects a stale learned Goal-rules edit instead of overwriting newer Goal feedback', () => {
        expect(() =>
            buildCalendarProjectRoutingConfigWriteData(
                'user-1',
                'calendar-project',
                {
                    enabled: true,
                    prompt: 'Route events',
                    learnedGoalRules: '- Stale Goal rules from the open settings modal',
                    learnedGoalRulesRevision: 2,
                },
                'me@example.com',
                {
                    learnedGoalRules: '- New Goal rule learned from a calendar task change',
                    learnedGoalRulesRevision: 3,
                    learnedGoalSeriesRoutes: {},
                }
            )
        ).toThrow('Goal routing learned rules changed while settings were open')
    })

    test('clearing learned rules also clears exact recurring-series mappings', () => {
        const seriesKey = buildCalendarSeriesRouteKey('google', 'series-1')
        const result = buildCalendarProjectRoutingConfigWriteData(
            'user-1',
            'calendar-project',
            { learnedRules: '', learnedRulesRevision: 2 },
            'me@example.com',
            {
                learnedRules: '- Route the weekly status to Project A',
                learnedRulesRevision: 2,
                learnedSeriesRoutes: {
                    [seriesKey]: {
                        recurringEventId: 'series-1',
                        provider: 'google',
                        targetProjectId: 'project-a',
                        learnedAt: 123,
                    },
                },
            }
        )

        expect(result.learnedRules).toBe('')
        expect(result.learnedSeriesRoutes).toEqual({})
    })

    test('clearing learned Goal rules also clears exact recurring Goal mappings', () => {
        const seriesKey = buildCalendarGoalSeriesRouteKey('google', 'series-1', 'project-a')
        const result = buildCalendarProjectRoutingConfigWriteData(
            'user-1',
            'calendar-project',
            { learnedGoalRules: '', learnedGoalRulesRevision: 3 },
            'me@example.com',
            {
                learnedGoalRules: '- Keep the weekly status without a Goal',
                learnedGoalRulesRevision: 3,
                learnedGoalSeriesRoutes: {
                    [seriesKey]: {
                        recurringEventId: 'series-1',
                        provider: 'google',
                        projectId: 'project-a',
                        routeToNoGoal: true,
                        learnedAt: 123,
                    },
                },
            }
        )

        expect(result.learnedGoalRules).toBe('')
        expect(result.learnedGoalSeriesRoutes).toEqual({})
    })

    test('finds the exact learned route for a recurring series', () => {
        const seriesKey = buildCalendarSeriesRouteKey('microsoft', 'series-1')
        const route = findLearnedCalendarSeriesRoute(
            {
                learnedSeriesRoutes: {
                    [seriesKey]: {
                        recurringEventId: 'series-1',
                        provider: 'microsoft',
                        targetProjectId: 'project-a',
                        learnedAt: 123,
                    },
                },
            },
            { provider: 'microsoft', seriesMasterId: 'series-1' }
        )

        expect(route).toEqual(expect.objectContaining({ targetProjectId: 'project-a' }))
    })

    test('finds exact recurring Goal assignments and no-Goal choices per project', () => {
        const assignedKey = buildCalendarGoalSeriesRouteKey('google', 'series-1', 'project-a')
        const noGoalKey = buildCalendarGoalSeriesRouteKey('google', 'series-1', 'project-b')
        const config = {
            learnedGoalSeriesRoutes: {
                [assignedKey]: {
                    recurringEventId: 'series-1',
                    provider: 'google',
                    projectId: 'project-a',
                    targetGoalId: 'goal-a',
                    learnedAt: 123,
                },
                [noGoalKey]: {
                    recurringEventId: 'series-1',
                    provider: 'google',
                    projectId: 'project-b',
                    routeToNoGoal: true,
                    learnedAt: 124,
                },
            },
        }

        expect(findLearnedCalendarGoalSeriesRoute(config, { recurringEventId: 'series-1' }, 'project-a')).toEqual(
            expect.objectContaining({ targetGoalId: 'goal-a', routeToNoGoal: false })
        )
        expect(findLearnedCalendarGoalSeriesRoute(config, { recurringEventId: 'series-1' }, 'project-b')).toEqual(
            expect.objectContaining({ routeToNoGoal: true, targetGoalId: '' })
        )
    })
})
