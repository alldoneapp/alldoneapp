const { loadWhatsAppHistoryContext } = require('./whatsAppHistoryContext')
const { loadDailyConversationHistory } = require('../Assistant/dailyConversationHistory')
jest.mock('../Assistant/dailyConversationHistory', () => ({
    HISTORY_LIMITS: { maxThreads: 3 },
    loadDailyConversationHistory: jest.fn(async () => 'formatted history'),
}))

const chat = (id, overrides = {}) => ({
    id,
    data: () => ({ creatorId: 'u1', type: 'topics', isPublicFor: [0], assistantId: 'a1', ...overrides }),
})
const now = Date.parse('2026-10-12T10:00:00Z')
function database(pages, user = { timezone: 'Europe/Berlin' }) {
    const queries = []
    return {
        queries,
        doc: jest.fn(() => ({ get: async () => ({ data: () => user }) })),
        collection: path => {
            const query = {
                where: jest.fn(() => query),
                orderBy: jest.fn(() => query),
                startAt: jest.fn(() => query),
                endAt: jest.fn(() => query),
                startAfter: jest.fn(() => query),
                limit: jest.fn(() => query),
                get: jest.fn(),
            }
            if (path === 'projects') query.get.mockResolvedValue({ docs: Object.keys(pages).map(id => ({ id })) })
            else for (const docs of pages[path.split('/')[1]]) query.get.mockResolvedValueOnce({ docs })
            queries.push({ path, query })
            return query
        },
    }
}
beforeEach(() => jest.clearAllMocks())

it('discovers existing daily WhatsApp chats across accessible projects, including a default-project change', async () => {
    const db = database({
        old: [[chat('BotChat20261011u1'), chat('BotChat20261010u1'), chat('BotChat20261009u1')]],
        new: [
            [
                chat('BotChat20261012u1'),
                chat('AnnaChat20261012u1'),
                chat('BotChatEmail20261012u1'),
                chat('BotChat20261011u2', { creatorId: 'u2' }),
                chat('BotChat20261011u1', { isPublicFor: ['u2'] }),
            ],
        ],
    })
    const runtime = { requestUserId: 'u1', projectId: 'new', objectId: 'BotChat20261012u1' }
    expect(await loadWhatsAppHistoryContext(db, runtime, { now })).toBe('formatted history')
    const threads = loadDailyConversationHistory.mock.calls[0][1]
    expect(threads.map(thread => `${thread.projectId}/${thread.chatId}`)).toEqual([
        'new/BotChat20261012u1',
        'old/BotChat20261011u1',
    ])
    expect(loadDailyConversationHistory).toHaveBeenCalledWith(
        db,
        threads,
        runtime,
        expect.objectContaining({ today: '20261012', yesterday: '20261011' })
    )
    expect(db.queries[0].query.where).toHaveBeenCalledWith('userIds', 'array-contains', 'u1')
    expect(db.queries[1].query.where).toHaveBeenCalledWith('creatorId', '==', 'u1')
    expect(db.queries[1].query.startAt).toHaveBeenCalledWith('u1', 'BotChat20261012\uf8ff')
    expect(db.queries[1].query.endAt).toHaveBeenCalledWith('u1', 'BotChat20261011')
})

it('paginates rejected or unrelated chats until it finds enough valid history', async () => {
    const rejected = Array.from({ length: 50 }, (_, i) => chat(`BotChat20261012other${i}`))
    const db = database({ p1: [rejected, [chat('BotChat20261011u1')]] })
    await loadWhatsAppHistoryContext(db, { requestUserId: 'u1' }, { now })
    expect(db.queries[1].query.startAfter).toHaveBeenCalledWith(rejected[49])
    expect(loadDailyConversationHistory.mock.calls[0][1]).toEqual([
        expect.objectContaining({ chatId: 'BotChat20261011u1' }),
    ])
    expect(await loadWhatsAppHistoryContext(db, { requestUserId: '../u2' })).toBe('')
})

it('uses the account calendar day even before local midnight and does not fill gaps with older days', async () => {
    const db = database(
        { p1: [[chat('BotChat20261012u1'), chat('BotChat20261011u1'), chat('BotChat20261009u1')]] },
        { timezone: 'America/Los_Angeles' }
    )
    await loadWhatsAppHistoryContext(db, { requestUserId: 'u1' }, { now: Date.parse('2026-10-12T01:00:00Z') })
    expect(db.queries[1].query.startAt).toHaveBeenCalledWith('u1', 'BotChat20261011\uf8ff')
    expect(db.queries[1].query.endAt).toHaveBeenCalledWith('u1', 'BotChat20261010')
    expect(loadDailyConversationHistory.mock.calls[0][1].map(thread => thread.dateKey)).toEqual(['20261011'])
})
