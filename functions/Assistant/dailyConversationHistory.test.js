const { loadDailyConversationHistory, HISTORY_LIMITS } = require('./dailyConversationHistory')
const { getAnnaHistoryWindow } = require('./annaHistoryWindow')

const historyWindow = getAnnaHistoryWindow({ timezone: 'Europe/Berlin' }, Date.parse('2026-10-12T10:00:00Z'))
function database({ long = false } = {}) {
    return {
        doc: jest.fn(() => ({
            get: async () => ({ data: () => ({ summary: long ? 's'.repeat(8000) : 'Earlier decisions' }) }),
        })),
        collection: jest.fn(() => {
            const query = {
                orderBy: jest.fn(() => query),
                limit: jest.fn(() => query),
                get: async () => ({
                    docs: Array.from({ length: 12 }, (_, i) => ({
                        data: () => ({
                            fromAssistant: i % 2 === 0,
                            commentText: `visible ${12 - i}`,
                            contextCommentText: long ? 'm'.repeat(2000) : `context ${12 - i}`,
                        }),
                    })),
                }),
            }
            return query
        }),
    }
}
const thread = (day, projectId = 'p1') => ({
    projectId,
    chatId: `day${day}`,
    assistantId: 'a1',
    dateKey: `202610${String(day).padStart(2, '0')}`,
})
const threads = Array.from({ length: 6 }, (_, i) => thread(12 - i))
const runtime = { projectId: 'p1', objectId: 'day12' }

it('includes only yesterday with its existing summary and twelve chronological messages', async () => {
    const db = database()
    const history = await loadDailyConversationHistory(db, threads, runtime, historyWindow)
    const entries = history.split('\n').map(JSON.parse)
    expect(entries.map(entry => entry.chatId)).toEqual(['day11'])
    expect(entries[0].summary).toBe('Earlier decisions')
    expect(entries[0].messages[0]).toEqual({ role: 'user', text: 'context 1' })
    expect(entries[0].messages[11]).toEqual({ role: 'assistant', text: 'context 12' })
    expect(entries[0].messages).toHaveLength(12)
    expect(db.collection.mock.results[0].value.limit).toHaveBeenCalledWith(12)
    expect(db.doc).toHaveBeenCalledWith('assistantThreadState/p1_topics_day11_a1')
    expect(db.collection).toHaveBeenCalledTimes(1)
})

it('retains other threads from today and yesterday after a project change, excluding the active thread', async () => {
    const history = await loadDailyConversationHistory(
        database(),
        [thread(12, 'p2'), thread(12), thread(11, 'p2'), thread(11), thread(10)],
        { projectId: 'p2', objectId: 'day12' },
        historyWindow
    )
    expect(history.split('\n').map(line => `${JSON.parse(line).projectId}/${JSON.parse(line).date}`)).toEqual([
        'p1/20261012',
        'p2/20261011',
        'p1/20261011',
    ])
})

it('never substitutes older or future threads when yesterday has no conversation', async () => {
    const db = database()
    expect(await loadDailyConversationHistory(db, [thread(13), thread(12), thread(10)], runtime, historyWindow)).toBe(
        ''
    )
    expect(db.doc).not.toHaveBeenCalled()
    expect(db.collection).not.toHaveBeenCalled()
})

it('keeps complete records within the shared character budget and trims individual fields', async () => {
    const history = await loadDailyConversationHistory(database({ long: true }), threads, runtime, historyWindow)
    expect(history.length).toBeLessThanOrEqual(HISTORY_LIMITS.totalChars)
    const entries = history.split('\n').map(JSON.parse)
    expect(entries).toHaveLength(1)
    expect(entries[0].summary).toHaveLength(HISTORY_LIMITS.summaryChars)
    for (const entry of entries) {
        expect(entry.summary.length).toBeLessThanOrEqual(HISTORY_LIMITS.summaryChars)
        for (const message of entry.messages)
            expect(message.text.length).toBeLessThanOrEqual(HISTORY_LIMITS.messageChars)
    }
})
