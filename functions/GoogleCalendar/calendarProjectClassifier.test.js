jest.mock('../Assistant/assistantHelper', () => ({
    getCachedEnvFunctions: jest.fn(() => ({})),
    getOpenAIClient: jest.fn(),
    normalizeModelKey: jest.fn(model => model),
}))

const { coerceCalendarProjectResult, normalizeCalendarEventForClassifier } = require('./calendarProjectClassifier')

describe('calendarProjectClassifier', () => {
    test('accepts a valid high-confidence project match', () => {
        const result = coerceCalendarProjectResult(
            {
                matched: true,
                projectId: 'project-a',
                confidence: 0.91,
                reasoning: 'Mentions the roadmap team.',
            },
            ['project-a', 'project-b'],
            0.7
        )

        expect(result).toEqual(
            expect.objectContaining({
                matched: true,
                projectId: 'project-a',
                confidence: 0.91,
            })
        )
    })

    test('rejects invalid project ids and low confidence matches', () => {
        expect(
            coerceCalendarProjectResult({ matched: true, projectId: 'invented', confidence: 0.95 }, ['project-a'], 0.7)
        ).toEqual(expect.objectContaining({ matched: false, projectId: null }))

        expect(
            coerceCalendarProjectResult({ matched: true, projectId: 'project-a', confidence: 0.2 }, ['project-a'], 0.7)
        ).toEqual(expect.objectContaining({ matched: false, projectId: null }))
    })

    test('normalizes calendar event details for classifier input', () => {
        const event = normalizeCalendarEventForClassifier(
            {
                id: 'event-1',
                summary: 'Product roadmap',
                location: 'Meet',
                attendees: [
                    {
                        email: 'person@example.com',
                        displayName: 'Person',
                        responseStatus: 'accepted',
                        self: true,
                    },
                ],
            },
            'me@example.com'
        )

        expect(event).toEqual(
            expect.objectContaining({
                id: 'event-1',
                summary: 'Product roadmap',
                location: 'Meet',
                calendarEmail: 'me@example.com',
                attendees: [
                    expect.objectContaining({
                        email: 'person@example.com',
                        responseStatus: 'accepted',
                        self: true,
                    }),
                ],
            })
        )
    })
})
