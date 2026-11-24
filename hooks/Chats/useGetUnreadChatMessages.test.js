/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useGetUnreadChatMessages from './useGetUnreadChatMessages'
import { getUnreadCommentIds, getUnreadMessageCount } from '../../components/ChatsView/Utils/unreadChatFilter'
import { ALL_TAB } from '../../components/Feeds/Utils/FeedsConstants'
import { COMMENTS_BY_ID_QUERY_CHUNK_SIZE } from '../../utils/backends/Chats/watchCommentsByIds'

jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: { firestore: { FieldPath: { documentId: () => '__name__' } } },
}))

// A fake comments collection that answers `where(documentId(), 'in', ids)` the way Firestore does.
// The old implementation used `orderBy('created', 'desc').limit(n)`, which this fake does not
// offer: the regression test fails loudly if the hook goes back to a "newest N" window.
let mockComments = {}
let mockQueries = []
jest.mock('../../utils/backends/firestore', () => {
    const watchers = {}
    return {
        globalWatcherUnsub: watchers,
        unwatch: key => {
            if (watchers[key]) {
                watchers[key]()
                delete watchers[key]
            }
        },
        getDb: () => ({
            collection: path => ({
                where: (field, op, ids) => {
                    if (field !== '__name__' || op !== 'in') throw new Error(`unexpected query ${field} ${op}`)
                    if (ids.length > 30) throw new Error('Firestore allows at most 30 values in an "in" filter')
                    return {
                        onSnapshot: next => {
                            const query = { path, ids, active: true }
                            mockQueries.push(query)
                            const docs = Object.keys(mockComments[path] || {})
                                .filter(id => ids.includes(id))
                                .sort()
                                .map(id => ({ id, data: () => mockComments[path][id] }))
                            next({ forEach: callback => docs.forEach(callback) })
                            return () => {
                                query.active = false
                            }
                        },
                    }
                },
            }),
        }),
    }
})

const PROJECT_ID = 'privat'
const CHAT_ID = 'daily-emails'
const COMMENTS_PATH = `chatComments/${PROJECT_ID}/topics/${CHAT_ID}/comments`

function Harness({ unreadCommentIds, onRender }) {
    onRender(useGetUnreadChatMessages(PROJECT_ID, CHAT_ID, 'topics', unreadCommentIds))
    return null
}

const renderHook = unreadCommentIds => {
    let result
    let tree
    act(() => {
        tree = renderer.create(<Harness unreadCommentIds={unreadCommentIds} onRender={value => (result = value)} />)
    })
    return { get: () => result, tree }
}

describe('useGetUnreadChatMessages (AT-3149)', () => {
    beforeEach(() => {
        mockQueries = []
        // Production shape of "Daily emails Privat 24.11.2026": 38 email comments, of which only the
        // 8th newest (GameStar newsletter) and the 3rd newest (Key Search notification) are unread;
        // every newer email was already read or archived.
        const comments = {}
        for (let index = 1; index <= 38; index += 1) {
            comments[`gmail-${String(index).padStart(2, '0')}`] = {
                created: 1000 + index,
                commentText: `Email ${index}`,
            }
        }
        mockComments = { [COMMENTS_PATH]: comments }
    })

    const OLDER_UNREAD = 'gmail-31' // 8th newest
    const NEWER_UNREAD = 'gmail-36' // 3rd newest

    it('lists an unread comment that newer, already read comments pushed out of the newest window', () => {
        const hook = renderHook([OLDER_UNREAD, NEWER_UNREAD])

        expect(hook.get().loaded).toBe(true)
        expect(hook.get().messages.map(message => message.id)).toEqual([OLDER_UNREAD, NEWER_UNREAD])
    })

    it('shows exactly as many messages as the Unread chip counts', () => {
        const projectChatNotifications = {
            [PROJECT_ID]: {
                totalFollowed: 0,
                totalUnfollowed: 2,
                [CHAT_ID]: {
                    totalFollowed: 0,
                    totalUnfollowed: 2,
                    unfollowedNotifications: [
                        { commentId: OLDER_UNREAD, date: 1031 },
                        { commentId: NEWER_UNREAD, date: 1036 },
                    ],
                },
            },
        }
        const chipCount = getUnreadMessageCount(projectChatNotifications, [PROJECT_ID], ALL_TAB)
        const hook = renderHook(getUnreadCommentIds(projectChatNotifications[PROJECT_ID][CHAT_ID]))

        expect(chipCount).toBe(2)
        expect(hook.get().messages).toHaveLength(chipCount)
    })

    it('reads only the unread comments, in chunks Firestore accepts', () => {
        const ids = Array.from({ length: 35 }, (_, index) => `gmail-${String(index + 1).padStart(2, '0')}`)
        const hook = renderHook(ids)

        expect(mockQueries.map(query => query.ids.length)).toEqual([COMMENTS_BY_ID_QUERY_CHUNK_SIZE, 5])
        expect(hook.get().messages).toHaveLength(35)
        expect(hook.get().messages[0].id).toBe('gmail-01')
    })

    it('reports loaded and nothing to show without unread ids, and opens no query', () => {
        const hook = renderHook([])

        expect(hook.get()).toEqual({ messages: [], loaded: true })
        expect(mockQueries).toHaveLength(0)
    })

    it('re-subscribes to the new set of ids and drops what became read at once', () => {
        const hook = renderHook([OLDER_UNREAD, NEWER_UNREAD])

        act(() => {
            hook.tree.update(<Harness unreadCommentIds={[NEWER_UNREAD]} onRender={() => {}} />)
        })
        let latest
        act(() => {
            hook.tree.update(<Harness unreadCommentIds={[NEWER_UNREAD]} onRender={value => (latest = value)} />)
        })

        expect(latest.messages.map(message => message.id)).toEqual([NEWER_UNREAD])
        expect(mockQueries[0].active).toBe(false)
        expect(mockQueries[mockQueries.length - 1]).toMatchObject({ ids: [NEWER_UNREAD], active: true })
    })

    it('stops listening on unmount', () => {
        const hook = renderHook([OLDER_UNREAD])
        act(() => hook.tree.unmount())

        expect(mockQueries.every(query => !query.active)).toBe(true)
    })
})
