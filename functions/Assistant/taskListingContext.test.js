const { withTaskListingMetadata, compactTaskListing } = require('./taskListingContext')
const { buildConversationSafeToolResult } = require('./attachmentToolHandoff')
const { prepareResearchRequest, compactResearchConversation } = require('./assistantResearchGuard')

const tasks = Array.from({ length: 82 }, (_, index) => ({
    id: `task-${index}`,
    humanReadableId: `AT-${index}`,
    name: `Prepare tomorrow's work item ${index}`,
    projectName: index < 40 ? 'Project One' : 'Project Two',
    completed: false,
    dueDate: Date.parse('2026-10-08T10:00:00+02:00'),
    isOwnedByRequestingUser: true,
    comments: [{ commentText: 'Historical detail. '.repeat(100) }],
}))

function conversation(result) {
    return [
        ['system', 'Existing instructions. '.repeat(5000)],
        ['user', 'What is on tomorrow?'],
        {
            role: 'assistant',
            tool_calls: [{ id: 'tasks', function: { name: 'get_tasks', arguments: '{"date":"2026-10-08"}' } }],
        },
        { role: 'tool', tool_call_id: 'tasks', content: JSON.stringify(result) },
    ]
}

const readResult = messages => JSON.parse(messages.find(entry => entry.role === 'tool').content)

describe('task listing counts survive model context limits', () => {
    test('the 82-task incident keeps authoritative totals through both compaction layers', () => {
        const result = withTaskListingMetadata({ tasks, count: 82, totalCount: 82, totalCountIsExact: true })
        const original = JSON.stringify(result)
        const safe = buildConversationSafeToolResult('get_tasks', result)
        expect(safe.tasks).toHaveLength(82)
        expect(safe.listingComplete).toBe(true)
        expect(safe.tasks.every(task => !task.comments)).toBe(true)
        expect(Buffer.byteLength(JSON.stringify(safe))).toBeLessThanOrEqual(40000)

        const prepared = prepareResearchRequest(conversation(safe))
        const compacted = readResult(prepared.messages)
        expect(prepared.stopReason).toBeNull()
        expect(compacted).toMatchObject({
            count: 82,
            totalCount: 82,
            totalCountIsExact: true,
            hasMore: true,
            listingComplete: false,
            contextTruncated: true,
        })
        expect(compacted.tasks.length).toBeGreaterThan(5)
        expect(compacted.shownCount).toBe(compacted.tasks.length)
        expect(compacted.countGuidance).toContain('partial')
        expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThanOrEqual(8000)
        expect(JSON.stringify(result)).toBe(original)
    })

    test('retrying with limit 20 never turns the returned page size into the full total', () => {
        const result = withTaskListingMetadata({
            tasks: tasks.slice(0, 20),
            count: 20,
            totalCount: 82,
            totalCountIsExact: true,
        })
        const compacted = readResult(compactResearchConversation(conversation(result)))
        expect(compacted).toMatchObject({ count: 20, totalCount: 82, totalCountIsExact: true, listingComplete: false })
        expect(compacted.tasks).toHaveLength(20)
        expect(compacted.shownCount).toBe(20)
        expect(readResult(compactResearchConversation(conversation(compacted), true))).toEqual(compacted)
    })

    test.each([500, 1000, 8000, 40000])(
        'respects a %i-byte budget without losing counts or shared ownership',
        budget => {
            const result = withTaskListingMetadata({
                tasks: tasks.map(task => ({
                    ...task,
                    name: '明日の仕事'.repeat(500),
                    isOwnedByRequestingUser: false,
                    ownerUserId: 'other-user',
                })),
                count: 82,
                totalCount: 82,
                totalCountIsExact: true,
                scope: 'visible',
            })
            const compacted = compactTaskListing(result, budget)
            expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThanOrEqual(budget)
            expect(compacted.totalCount).toBe(82)
            expect(compacted.listingComplete).toBe(false)
            compacted.tasks.forEach(task =>
                expect(task).toMatchObject({ ownerUserId: 'other-user', isOwnedByRequestingUser: false })
            )
        }
    )

    test('failed project queries and unavailable counts cannot become exact totals after compaction', () => {
        const result = {
            tasks: tasks.slice(0, 20),
            count: 20,
            totalCount: 82,
            totalCountIsExact: true,
            retrieval: { resultsAreIncomplete: true, projectsFailed: 1 },
        }
        const compacted = compactTaskListing(result, 500)
        expect(compacted).toMatchObject({ totalCount: 82, totalCountIsExact: false, listingComplete: false })
        expect(compacted.retrieval.resultsAreIncomplete).toBe(true)
        expect(compacted.countGuidance).toContain('lower bound')
        expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThanOrEqual(500)
        expect(withTaskListingMetadata({ tasks: [], count: 0 })).toMatchObject({
            totalCountIsExact: false,
            listingComplete: false,
            hasMore: null,
        })
    })

    test('a complete empty query remains authoritative', () => {
        expect(withTaskListingMetadata({ tasks: [], count: 0, totalCount: 0, totalCountIsExact: true })).toMatchObject({
            totalCount: 0,
            shownCount: 0,
            listingComplete: true,
            hasMore: false,
        })
    })
})
