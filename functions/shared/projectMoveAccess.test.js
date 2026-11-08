'use strict'

// security audit 2026-11: a manual project move used to pull in objects the actor could not read
// (another member's private goal tasks, a task listed in a forged subtaskIds, a goal's or task's
// private linked note) and re-privatize them to the actor. Every pulled-in object is now checked.

jest.mock('firebase-admin', () => ({
    firestore: { FieldValue: { arrayUnion: value => ({ arrayUnion: value }) } },
}))
jest.mock('./goalFocusAreas', () => ({ resolveFocusAreaForProjectMove: jest.fn(async () => null) }))
jest.mock('../Chats/copyProjectMoveChat', () => ({ copyProjectMoveChat: jest.fn(async () => ({})) }))
jest.mock('./notesStorageBucket', () => ({ getNotesBucketName: () => 'notes-bucket' }))
jest.mock('../Feeds/globalFeedsHelper', () => ({ copyInnerFeedsToOtherProject: jest.fn(async () => {}) }))
jest.mock('./moveNoteToDifferentProject', () => ({ moveNoteToDifferentProject: jest.fn(async () => ({})) }))

const { BACKLOG_DATE_NUMERIC } = require('../Utils/HelperFunctionsCloud')
const { moveNoteToDifferentProject } = require('./moveNoteToDifferentProject')
const { moveTaskToDifferentProject } = require('./moveTaskToDifferentProject')
const { moveObjectToDifferentProject } = require('./moveObjectToDifferentProject')

function createDatabase(initial) {
    const state = new Map(Object.entries(initial))
    const snapshot = (path, value) => ({ id: path.split('/').pop(), exists: value !== undefined, data: () => value })
    const doc = path => ({
        path,
        get: async () => snapshot(path, state.get(path)),
        set: async (data, options) => state.set(path, options?.merge ? { ...(state.get(path) || {}), ...data } : data),
        update: async data => {
            if (!state.has(path)) throw new Error(`not found: ${path}`)
            state.set(path, { ...state.get(path), ...data })
        },
        delete: async () => state.delete(path),
    })
    const database = {
        doc,
        collection: prefix => ({
            where: (field, op, value) => ({
                get: async () => ({
                    docs: [...state.entries()]
                        .filter(([path, data]) => path.startsWith(`${prefix}/`) && data?.[field] === value)
                        .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data })),
                }),
            }),
        }),
        batch: () => ({
            set: (ref, data, options) =>
                state.set(ref.path, options?.merge ? { ...(state.get(ref.path) || {}), ...data } : data),
            commit: async () => {},
        }),
    }
    return { database, state }
}

const noop = jest.fn(async () => {})

describe('manual task move tree', () => {
    it('does not pull a task listed in subtaskIds that is not really a child', async () => {
        const { database, state } = createDatabase({
            'items/shared/tasks/own': { userId: 'actor', isPublicFor: [0, 'actor'], subtaskIds: ['victim-task'] },
            'items/shared/tasks/victim-task': { userId: 'victim', isPublicFor: ['victim'], parentId: null },
        })

        await moveTaskToDifferentProject({
            database,
            sourceProjectId: 'shared',
            targetProjectId: 'mine',
            taskId: 'own',
            editorId: 'actor',
            manual: true,
            requestId: 'r1',
            targetProject: { id: 'mine', userIds: ['actor'] },
            moveManualChat: noop,
            copyInnerFeeds: noop,
        })

        expect(state.has('items/mine/tasks/victim-task')).toBe(false)
        expect(state.get('items/shared/tasks/victim-task')).toMatchObject({ isPublicFor: ['victim'] })
    })

    it('does not move a tree holding a real child the actor cannot read', async () => {
        const { database, state } = createDatabase({
            'items/shared/tasks/own': { userId: 'actor', isPublicFor: [0], subtaskIds: ['private-child'] },
            'items/shared/tasks/private-child': { userId: 'victim', isPublicFor: ['victim'], parentId: 'own' },
        })

        await expect(
            moveTaskToDifferentProject({
                database,
                sourceProjectId: 'shared',
                targetProjectId: 'mine',
                taskId: 'own',
                editorId: 'actor',
                manual: true,
                requestId: 'r1',
                targetProject: { id: 'mine', userIds: ['actor'] },
                moveManualChat: noop,
                copyInnerFeeds: noop,
            })
        ).rejects.toMatchObject({ code: 'permission-denied' })
        expect([...state.keys()].some(path => path.startsWith('items/mine/'))).toBe(false)
    })

    it('leaves a linked note the actor cannot read behind', async () => {
        const { database, state } = createDatabase({
            'items/shared/tasks/own': { userId: 'actor', isPublicFor: [0], noteId: 'victim-note' },
            'noteItems/shared/notes/victim-note': { isPublicFor: ['victim'] },
        })

        await moveTaskToDifferentProject({
            database,
            sourceProjectId: 'shared',
            targetProjectId: 'mine',
            taskId: 'own',
            editorId: 'actor',
            manual: true,
            requestId: 'r1',
            targetProject: { id: 'mine', userIds: ['actor'] },
            moveManualChat: noop,
            copyInnerFeeds: noop,
        })

        expect(state.get('items/mine/tasks/own')).toMatchObject({ noteId: null })
    })
})

describe('manual goal move', () => {
    const goal = {
        isPublicFor: [0],
        ownerId: 'actor',
        assigneesIds: ['actor'],
        completionMilestoneDate: BACKLOG_DATE_NUMERIC,
        noteId: 'victim-note',
    }

    it('moves only goal tasks and notes the actor can read', async () => {
        const { database, state } = createDatabase({
            'projects/shared': { userIds: ['actor', 'victim'] },
            'projects/mine': { userIds: ['actor'] },
            'goals/shared/items/goal-1': goal,
            'items/shared/tasks/public-task': { userId: 'actor', isPublicFor: [0], parentGoalId: 'goal-1' },
            'items/shared/tasks/victim-task': { userId: 'victim', isPublicFor: ['victim'], parentGoalId: 'goal-1' },
            'noteItems/shared/notes/victim-note': { isPublicFor: ['victim'] },
        })

        await moveObjectToDifferentProject({
            database,
            objectType: 'goal',
            sourceProjectId: 'shared',
            targetProjectId: 'mine',
            objectId: 'goal-1',
            actorId: 'actor',
            requestId: 'r1',
            copyInnerFeeds: noop,
            moveManualChat: noop,
        })

        expect(state.has('items/mine/tasks/public-task')).toBe(true)
        expect(state.has('items/mine/tasks/victim-task')).toBe(false)
        expect(state.get('items/shared/tasks/victim-task')).toMatchObject({
            isPublicFor: ['victim'],
            parentGoalId: null,
        })
        expect(moveNoteToDifferentProject).not.toHaveBeenCalled()
        expect(state.get('goals/mine/items/goal-1')).toMatchObject({ noteId: null })
    })
})
