jest.mock('firebase-admin', () => {
    const get = jest.fn(() => Promise.resolve({ data: () => ({ gold: 10 }) }))
    const doc = jest.fn(() => ({ get }))
    const collection = jest.fn(() => ({ doc }))

    return {
        firestore: jest.fn(() => ({
            collection,
        })),
        __mock: {
            get,
        },
    }
})

jest.mock('../Assistant/assistantHelper', () => ({
    calculateGoldCostFromTokens: jest.fn(() => 2),
}))

jest.mock('../Gold/goldHelper', () => ({
    deductGold: jest.fn(() => Promise.resolve({ success: true })),
}))

jest.mock('./calendarProjectClassifier', () => ({
    classifyCalendarEventProject: jest.fn(),
}))

jest.mock('./calendarProjectRoutingConfig', () => ({
    buildCalendarProjectDefinitions: jest.fn(() => [
        { projectId: 'project-a', name: 'Project A', routingDescription: 'Project A work' },
    ]),
    loadActiveProjectsForCalendarRouting: jest.fn(() =>
        Promise.resolve([{ id: 'project-a', name: 'Project A', description: 'Project A work' }])
    ),
    loadCalendarProjectRoutingConfig: jest.fn(() =>
        Promise.resolve({
            config: {
                enabled: true,
                prompt: 'Route events',
                model: 'MODEL_GPT5_4_NANO',
                confidenceThreshold: 0.7,
            },
        })
    ),
}))

const admin = require('firebase-admin')
const { deductGold } = require('../Gold/goldHelper')
const { classifyCalendarEventProject } = require('./calendarProjectClassifier')
const { routeCalendarEventsToProjects } = require('./calendarProjectRouting')

const premiumUser = {
    premium: { status: 'premium' },
    projectIds: ['project-a'],
}

const event = { id: 'event-1', summary: 'Project A meeting' }

describe('calendarProjectRouting', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        admin.__mock.get.mockResolvedValue({ data: () => ({ gold: 10 }) })
    })

    test('returns a target project map for confident matches and charges gold', async () => {
        classifyCalendarEventProject.mockResolvedValue({
            matched: true,
            projectId: 'project-a',
            confidence: 0.9,
            reasoning: 'Clear project match.',
            usage: { totalTokens: 100 },
        })

        const result = await routeCalendarEventsToProjects({
            userId: 'user-1',
            syncProjectId: 'connected-project',
            userData: premiumUser,
            events: [event],
            calendarEmail: 'me@example.com',
        })

        expect(result).toEqual({ 'event-1': 'project-a' })
        expect(deductGold).toHaveBeenCalledWith(
            'user-1',
            2,
            expect.objectContaining({
                source: 'calendar_project_routing',
                projectId: 'connected-project',
                objectId: 'event-1',
                channel: 'calendar',
            })
        )
    })

    test('falls back to the connected project when there is no confident match', async () => {
        classifyCalendarEventProject.mockResolvedValue({
            matched: false,
            projectId: null,
            confidence: 0.2,
            reasoning: 'No clear project.',
            usage: { totalTokens: 100 },
        })

        const result = await routeCalendarEventsToProjects({
            userId: 'user-1',
            syncProjectId: 'connected-project',
            userData: premiumUser,
            events: [event],
            calendarEmail: 'me@example.com',
        })

        expect(result).toEqual({})
        expect(deductGold).toHaveBeenCalled()
    })

    test('skips classification for non-premium users', async () => {
        const result = await routeCalendarEventsToProjects({
            userId: 'user-1',
            syncProjectId: 'connected-project',
            userData: { premium: { status: 'free' } },
            events: [event],
            calendarEmail: 'me@example.com',
        })

        expect(result).toEqual({})
        expect(classifyCalendarEventProject).not.toHaveBeenCalled()
    })

    test('skips classification when gold is insufficient', async () => {
        admin.__mock.get.mockResolvedValue({ data: () => ({ gold: 0 }) })

        const result = await routeCalendarEventsToProjects({
            userId: 'user-1',
            syncProjectId: 'connected-project',
            userData: premiumUser,
            events: [event],
            calendarEmail: 'me@example.com',
        })

        expect(result).toEqual({})
        expect(classifyCalendarEventProject).not.toHaveBeenCalled()
    })

    test('falls back without charging when the classifier fails before usage', async () => {
        classifyCalendarEventProject.mockRejectedValue(new Error('Calendar project routing classifier unavailable.'))

        const result = await routeCalendarEventsToProjects({
            userId: 'user-1',
            syncProjectId: 'connected-project',
            userData: premiumUser,
            events: [event],
            calendarEmail: 'me@example.com',
        })

        expect(result).toEqual({})
        expect(deductGold).not.toHaveBeenCalled()
    })
})
