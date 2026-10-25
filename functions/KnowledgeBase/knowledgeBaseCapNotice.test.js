const { KnowledgeFirestoreDouble, fieldValue } = require('./__fixtures__/knowledgeFirestoreDouble')
const { notifyKnowledgeBaseCapReached, __private__ } = require('./knowledgeBaseCapNotice')

const PROJECT_ID = 'project-a'
const NOW = Date.UTC(2026, 9, 25, 21, 30)
const RESUMES_AT = Date.UTC(2026, 10, 1)
const CHAT_ID = 'WikiGoldCap_project-a_2026-10'
const CHAT_PATH = `chatObjects/${PROJECT_ID}/chats/${CHAT_ID}`
const commentPath = commentId => `chatComments/${PROJECT_ID}/topics/${CHAT_ID}/comments/${commentId}`

function createDb(projectUserIds = ['owner', 'teammate']) {
    return new KnowledgeFirestoreDouble({
        [`projects/${PROJECT_ID}`]: { name: 'JTL Software - Project Juno', userIds: projectUserIds },
    })
}

// Behaves like the real storeAssistantMessageInTopicOnce: a comment id is written at most once.
function storeOnceDouble(db) {
    return jest.fn(async ({ projectId, chatId, commentId, responseText, assistantId, extraCommentFields }) => {
        const path = `chatComments/${projectId}/topics/${chatId}/comments/${commentId}`
        if (db.read(path)) return { commentId, stored: false }
        await db.doc(path).set({ commentText: responseText, creatorId: assistantId, ...extraCommentFields })
        return { commentId, stored: true }
    })
}

function notify(db, overrides = {}) {
    return notifyKnowledgeBaseCapReached({
        projectId: PROJECT_ID,
        ownerUserId: 'owner',
        ownerData: { language: 'de', assistantId: 'anna' },
        month: '2026-10',
        spent: 506,
        goldCap: 500,
        resumesAt: RESUMES_AT,
        db,
        fieldValue,
        now: NOW,
        resolveAssistantId: async () => 'project-assistant',
        storeAssistantMessageInTopicOnce: storeOnceDouble(db),
        getBaseUrl: () => 'https://my.alldone.app',
        ...overrides,
    })
}

describe('notifyKnowledgeBaseCapReached', () => {
    it("opens a private topic for the payer in which the project's assistant explains the pause", async () => {
        const db = createDb()

        const result = await notify(db)

        expect(result).toEqual({ notified: true, chatId: CHAT_ID })
        expect(db.read(CHAT_PATH)).toMatchObject({
            type: 'topics',
            title: 'Projekt-Wiki pausiert: Gold-Limit erreicht (Oktober 2026)',
            isPublicFor: ['owner'],
            assistantId: 'project-assistant',
            usersFollowing: ['owner'],
            isAssistantEnabled: true,
        })
        const comment = db.read(commentPath('wiki-gold-cap-2026-10-500'))
        expect(comment).toMatchObject({
            creatorId: 'project-assistant',
            source: 'knowledge_base',
            isSystemNotice: true,
            knowledgeBaseNotice: 'monthly_cap',
        })
        expect(comment.commentText).toContain('„JTL Software - Project Juno“')
        expect(comment.commentText).toContain('506 von 500 Gold')
        expect(comment.commentText).toContain('bis zum 1. November 2026')
        expect(comment.commentText).toContain('https://my.alldone.app/project/project-a/wiki-settings')
        expect(db.read(`chatNotifications/${PROJECT_ID}/owner/wiki-gold-cap-2026-10-500`)).toMatchObject({
            chatId: CHAT_ID,
            chatType: 'topics',
            creatorId: 'project-assistant',
        })
        expect(db.read(`usersFollowing/${PROJECT_ID}/entries/owner`)).toEqual({ topics: { [CHAT_ID]: true } })
        expect(db.read(`followers/${PROJECT_ID}/topics/${CHAT_ID}`)).toEqual({ usersFollowing: ['owner'] })
    })

    it('tells the payer once per month and limit, however often a run stops there', async () => {
        const db = createDb()
        await notify(db)
        db.doc(`chatNotifications/${PROJECT_ID}/owner/wiki-gold-cap-2026-10-500`).delete()

        const again = await notify(db)

        expect(again).toMatchObject({ notified: false, reason: 'already_notified' })
        // Read is read: a retried run must not bring the badge back.
        expect(db.read(`chatNotifications/${PROJECT_ID}/owner/wiki-gold-cap-2026-10-500`)).toBeUndefined()
    })

    it('reports a raised limit that is reached again in the same topic', async () => {
        const db = createDb()
        await notify(db)

        const result = await notify(db, { goldCap: 1000, spent: 1003 })

        expect(result).toEqual({ notified: true, chatId: CHAT_ID })
        expect(db.read(commentPath('wiki-gold-cap-2026-10-1000')).commentText).toContain('1003 von 1000 Gold')
        expect(db.read(CHAT_PATH).title).toBe('Projekt-Wiki pausiert: Gold-Limit erreicht (Oktober 2026)')
    })

    it("asks for the project's assistant with the payer's own default as the fallback", async () => {
        const db = createDb()
        const resolveAssistantId = jest.fn(async () => 'project-assistant')

        await notify(db, { resolveAssistantId })

        expect(resolveAssistantId).toHaveBeenCalledWith(
            expect.objectContaining({ defaultAssistantId: 'anna' }),
            PROJECT_ID
        )
    })

    it('posts nothing for a payer who is no longer a member of the project', async () => {
        const db = createDb(['teammate'])
        const store = storeOnceDouble(db)

        const result = await notify(db, { storeAssistantMessageInTopicOnce: store })

        expect(result).toEqual({ notified: false, reason: 'owner_not_member' })
        expect(store).not.toHaveBeenCalled()
        expect(db.read(CHAT_PATH)).toBeUndefined()
    })

    it('posts nothing when the project has no assistant to speak', async () => {
        const db = createDb()

        const result = await notify(db, { resolveAssistantId: async () => null })

        expect(result).toEqual({ notified: false, reason: 'no_assistant' })
        expect(db.read(CHAT_PATH)).toBeUndefined()
    })

    it('never throws into the run that stopped', async () => {
        const db = createDb()
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

        const result = await notify(db, {
            storeAssistantMessageInTopicOnce: async () => {
                throw new Error('Firestore unavailable')
            },
        })

        expect(result).toEqual({ notified: false, reason: 'failed' })
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })
})

describe('cap notice text', () => {
    const { buildCapNotice, resolveNoticeLanguage, getWikiSettingsUrl } = __private__
    const base = {
        projectName: 'Alldone Product',
        month: '2026-10',
        spent: 505.4,
        goldCap: 500,
        resumesAt: RESUMES_AT,
        settingsUrl: 'https://my.alldone.app/project/p/wiki-settings',
    }

    it('reads short codes and language names, and falls back to English', () => {
        expect(resolveNoticeLanguage('de')).toBe('de')
        expect(resolveNoticeLanguage('German')).toBe('de')
        expect(resolveNoticeLanguage('es')).toBe('es')
        expect(resolveNoticeLanguage('Spanish')).toBe('es')
        expect(resolveNoticeLanguage('fr')).toBe('en')
        expect(resolveNoticeLanguage(undefined)).toBe('en')
    })

    it('writes English and Spanish with the date of the first of next month', () => {
        const english = buildCapNotice({ ...base, language: 'en' })
        expect(english.title).toBe('Project wiki paused: Gold limit reached (October 2026)')
        expect(english.text).toContain('(505 of 500 Gold) and is paused until November 1, 2026')

        const spanish = buildCapNotice({ ...base, language: 'es' })
        expect(spanish.text).toContain('(505 de 500 Gold) y está en pausa hasta el 1 de noviembre de 2026')
    })

    it('builds the wiki settings address the app routes to', () => {
        expect(getWikiSettingsUrl('https://my.alldone.app/', 'p1')).toBe(
            'https://my.alldone.app/project/p1/wiki-settings'
        )
    })
})
