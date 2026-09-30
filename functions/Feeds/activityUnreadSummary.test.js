jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('firebase-admin/firestore', () => {
    class FieldPath {
        constructor(...segments) {
            this.segments = segments
        }
    }
    return { FieldPath, FieldValue: { delete: () => '__DELETE__' } }
})

const { mirrorChatNotification, mirrorFeedsCount } = require('./activityUnreadSummary')

// A tiny Firestore double that applies set()/merge/mergeFields the way Firestore does.
const createDb = sources => {
    const docs = new Map(Object.entries(sources))
    const applyDelete = (target, value) => {
        Object.entries(value).forEach(([key, entry]) => {
            if (entry === '__DELETE__') delete target[key]
            else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                target[key] = target[key] || {}
                applyDelete(target[key], entry)
            } else target[key] = entry
        })
    }
    return {
        docs,
        doc: path => ({
            get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
            set: async (value, options) => {
                const current = JSON.parse(JSON.stringify(docs.get(path) || {}))
                if (options?.mergeFields) {
                    options.mergeFields.forEach(({ segments }) => {
                        let source = value
                        let target = current
                        segments.forEach((segment, index) => {
                            source = source[segment]
                            if (index === segments.length - 1) target[segment] = source
                            else target = target[segment] = target[segment] || {}
                        })
                    })
                } else applyDelete(current, value)
                docs.set(path, current)
            },
        }),
    }
}

const SUMMARY = 'users/u1/private/activityUnreadSummary'

describe('activity unread summary mirror', () => {
    it('replaces a feed tab with the current source document, dropping counters the source removed', async () => {
        const db = createDb({
            'feedsCount/p1/u1/followed': { tasks: { t2: { amount: 1 } } },
            [SUMMARY]: { feeds: { p1: { followed: { tasks: { t1: { amount: 3 } } }, all: { x: 1 } } } },
        })

        await mirrorFeedsCount({ projectId: 'p1', userId: 'u1', tab: 'followed' }, db)

        expect(db.docs.get(SUMMARY).feeds.p1).toEqual({ followed: { tasks: { t2: { amount: 1 } } }, all: { x: 1 } })
        expect(db.docs.get(SUMMARY).mirrorVersion).toBe(1)
    })

    it('removes the entry once the source document is gone, whichever event arrived', async () => {
        const db = createDb({ [SUMMARY]: { feeds: { p1: { all: { x: 1 } } }, chats: { p1: { c1: { chatId: 'a' } } } } })

        await mirrorFeedsCount({ projectId: 'p1', userId: 'u1', tab: 'all' }, db)
        await mirrorChatNotification({ projectId: 'p1', userId: 'u1', commentId: 'c1' }, db)

        expect(db.docs.get(SUMMARY)).toEqual({ mirrorVersion: 1, feeds: { p1: {} }, chats: { p1: {} } })
    })

    it('mirrors a chat notification verbatim', async () => {
        const db = createDb({ 'chatNotifications/p1/u1/c9': { chatId: 'chat', followed: true } })

        await mirrorChatNotification({ projectId: 'p1', userId: 'u1', commentId: 'c9' }, db)

        expect(db.docs.get(SUMMARY).chats.p1.c9).toEqual({ chatId: 'chat', followed: true })
    })

    it('ignores workstream ids and unknown feed tabs', async () => {
        const db = createDb({ 'feedsCount/p1/ws@default/all': { x: 1 } })

        expect(await mirrorFeedsCount({ projectId: 'p1', userId: 'ws@default', tab: 'all' }, db)).toBe(false)
        expect(await mirrorFeedsCount({ projectId: 'p1', userId: 'u1', tab: 'other' }, db)).toBe(false)
        expect(db.docs.has('users/ws@default/private/activityUnreadSummary')).toBe(false)
    })
})
