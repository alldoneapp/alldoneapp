const {
    DAILY_ADS_CHAT_ID_PREFIX,
    buildDailyAdsLineText,
    buildDailyAdsTopicTitle,
    ensureDailyAdsTopic,
    getDailyAdsChatId,
    shouldWriteDailyAdsLine,
    writeDailyAdsLine,
} = require('./dailyAdsDigest')

function buildDatabase({ existing = false, createError = null } = {}) {
    const chatDocs = new Map()
    const database = {
        chatDocs,
        doc: jest.fn(path => ({
            get: jest.fn(async () => ({ exists: existing || chatDocs.has(path) })),
            create: jest.fn(async data => {
                if (createError) throw createError
                chatDocs.set(path, data)
            }),
        })),
    }
    return database
}

describe('dailyAdsDigest (AT-3101)', () => {
    describe('shouldWriteDailyAdsLine', () => {
        test('an incoming email under the built-in Ads label without a prompt gets a line', () => {
            expect(shouldWriteDailyAdsLine({ labelKey: 'ads', direction: 'incoming', hasPrompt: false })).toBe(true)
        })

        test('an unlabeled email the classifier called ads gets a line', () => {
            expect(shouldWriteDailyAdsLine({ labelKey: '', emailKind: 'ads', direction: 'incoming' })).toBe(true)
        })

        test('a label that has its own prompt keeps running it', () => {
            expect(shouldWriteDailyAdsLine({ labelKey: 'ads', direction: 'incoming', hasPrompt: true })).toBe(false)
        })

        test('mail the owner sent never gets a line', () => {
            expect(shouldWriteDailyAdsLine({ labelKey: 'ads', direction: 'outgoing' })).toBe(false)
        })

        test('newsletters, notifications and people are not ads', () => {
            expect(shouldWriteDailyAdsLine({ labelKey: 'newsletter', emailKind: 'ads', direction: 'incoming' })).toBe(
                false
            )
            expect(shouldWriteDailyAdsLine({ emailKind: 'newsletter', direction: 'incoming' })).toBe(false)
            expect(shouldWriteDailyAdsLine({ emailKind: 'notification', direction: 'incoming' })).toBe(false)
            expect(shouldWriteDailyAdsLine({ emailKind: 'person', direction: 'incoming' })).toBe(false)
            expect(shouldWriteDailyAdsLine({ direction: 'incoming' })).toBe(false)
        })
    })

    test('the line is the digest format with the subject as summary', () => {
        expect(buildDailyAdsLineText({ from: 'Shop <Deals@Shop.example>', subject: '  Black   week ' })).toBe(
            'Email from Shop (deals@shop.example): Black week'
        )
        expect(buildDailyAdsLineText({ from: 'deals@shop.example', subject: '' })).toBe(
            'Email from deals@shop.example: (no subject)'
        )
        const long = buildDailyAdsLineText({ from: 'Shop <d@s.example>', subject: 'x'.repeat(400) })
        expect(long.length).toBeLessThan(260)
        expect(long.endsWith('...')).toBe(true)
    })

    test('one private topic per user and day', () => {
        expect(buildDailyAdsTopicTitle('18.11.2026')).toBe('Daily ads 18.11.2026')
        const id = getDailyAdsChatId('user-1', '18.11.2026')
        expect(id.startsWith(DAILY_ADS_CHAT_ID_PREFIX)).toBe(true)
        expect(getDailyAdsChatId('user-1', '18.11.2026')).toBe(id)
        expect(getDailyAdsChatId('user-2', '18.11.2026')).not.toBe(id)
        expect(getDailyAdsChatId('user-1', '19.11.2026')).not.toBe(id)
    })

    test('creates the topic private to the owner, once', async () => {
        const database = buildDatabase()
        const first = await ensureDailyAdsTopic({
            database,
            projectId: 'p1',
            chatId: 'DailyAds_x',
            title: 'Daily ads 18.11.2026',
            userId: 'user-1',
            assistantId: 'assistant-1',
        })
        expect(first.created).toBe(true)
        const chat = database.chatDocs.get('chatObjects/p1/chats/DailyAds_x')
        expect(chat).toEqual(
            expect.objectContaining({
                title: 'Daily ads 18.11.2026',
                type: 'topics',
                isPublicFor: ['user-1'],
                members: ['user-1'],
                assistantId: 'assistant-1',
                commentsData: expect.objectContaining({ amount: 0 }),
            })
        )
        const second = await ensureDailyAdsTopic({
            database,
            projectId: 'p1',
            chatId: 'DailyAds_x',
            title: 'Daily ads 18.11.2026',
            userId: 'user-1',
        })
        expect(second.created).toBe(false)
    })

    test('a concurrent create is not an error', async () => {
        const error = Object.assign(new Error('6 ALREADY_EXISTS: Document already exists'), { code: 6 })
        const database = buildDatabase({ createError: error })
        await expect(
            ensureDailyAdsTopic({ database, projectId: 'p1', chatId: 'c', title: 't', userId: 'u' })
        ).resolves.toEqual({ chatId: 'c', created: false })
    })

    test.each([
        ['show', false],
        ['archive', true],
    ])('writes the line by chat id, keeping suppressUnread (setting %s)', async (setting, suppressUnread) => {
        const database = buildDatabase()
        const addChatComment = jest.fn(async () => ({ commentId: 'gmail-abc', skippedDuplicate: false }))
        const result = await writeDailyAdsLine({
            database,
            projectId: 'default-project',
            userId: 'user-1',
            assistantId: 'assistant-1',
            formattedDate: '18.11.2026',
            normalizedMessage: { from: 'Shop <deals@shop.example>', subject: 'Black week', messageId: 'm1' },
            gmailContext: {
                origin: 'gmail_label_follow_up',
                messageId: 'm1',
                labelKey: 'ads',
                emailKind: 'ads',
                followUpType: 'actionable',
                suppressUnread,
            },
            addChatComment,
        })

        const chatId = getDailyAdsChatId('user-1', '18.11.2026')
        expect(addChatComment).toHaveBeenCalledWith({
            projectId: 'default-project',
            chatId,
            comment: 'Email from Shop (deals@shop.example): Black week',
            assistantId: 'assistant-1',
            userId: 'user-1',
            gmailContext: expect.objectContaining({
                labelKey: 'ads',
                followUpType: 'informational',
                suppressUnread,
            }),
        })
        expect(result).toEqual({
            projectId: 'default-project',
            chatId,
            chatTitle: 'Daily ads 18.11.2026',
            commentId: 'gmail-abc',
            skippedDuplicate: false,
        })
    })
})
