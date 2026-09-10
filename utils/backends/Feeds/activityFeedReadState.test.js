import firebase from 'firebase/compat/app'

import { isNewComment, isUserAuthoredFeed, queueObjectActivityFeedUnreadClear } from './activityFeedReadState'

jest.mock('firebase/compat/app', () => ({
    firestore: {
        FieldValue: {
            delete: jest.fn(() => 'DELETE_FIELD'),
        },
    },
}))

describe('activityFeedReadState', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('recognizes only activity entries authored by the signed-in user', () => {
        expect(isUserAuthoredFeed({ creatorId: 'user-1' }, 'user-1')).toBe(true)
        expect(isUserAuthoredFeed({ creatorId: 'assistant-1' }, 'user-1')).toBe(false)
        expect(isUserAuthoredFeed({}, 'user-1')).toBe(false)
        expect(isUserAuthoredFeed({ creatorId: 'user-1' }, null)).toBe(false)
    })

    it('recognizes newly added comments but not comment edits', () => {
        expect(isNewComment(null)).toBe(true)
        expect(isNewComment(undefined)).toBe(true)
        expect(isNewComment('existing-comment-id')).toBe(false)
    })

    it('queues deletion of the object unread entry in both activity-feed tabs only', () => {
        const db = { doc: jest.fn(path => ({ path })) }
        const batch = { set: jest.fn() }

        expect(
            queueObjectActivityFeedUnreadClear(db, batch, {
                projectId: 'project-1',
                userId: 'user-1',
                objectType: 'tasks',
                objectId: 'task-1',
            })
        ).toBe(true)

        expect(firebase.firestore.FieldValue.delete).toHaveBeenCalledTimes(1)
        expect(db.doc.mock.calls.map(([path]) => path)).toEqual([
            'feedsCount/project-1/user-1/followed',
            'feedsCount/project-1/user-1/all',
        ])
        expect(batch.set).toHaveBeenCalledTimes(2)
        batch.set.mock.calls.forEach(([, data, options]) => {
            expect(data).toEqual({ tasks: { 'task-1': 'DELETE_FIELD' } })
            expect(options).toEqual({ merge: true })
        })
        expect(db.doc.mock.calls.some(([path]) => path.includes('chatNotifications'))).toBe(false)
    })

    it('does not queue writes when the object identity is incomplete', () => {
        const db = { doc: jest.fn() }
        const batch = { set: jest.fn() }

        expect(
            queueObjectActivityFeedUnreadClear(db, batch, {
                projectId: 'project-1',
                userId: 'user-1',
                objectType: 'tasks',
            })
        ).toBe(false)
        expect(batch.set).not.toHaveBeenCalled()
    })
})
