'use strict'

// Security audit 2026-11 (high): a guide copy must only carry what the template's creator can see.
// Objects private to another member of the template project, and private notes hanging off a copied
// task, were copied into the joiner's guide.

jest.mock('../Firestore/templatesFirestore', () => ({
    getMainOpenTasks: jest.fn(),
    getOpenMilestones: jest.fn(async () => ({})),
    getAllNotes: jest.fn(),
    getListFollowedContacts: jest.fn(),
}))
jest.mock('../Goals/goalsFirestore', () => ({ getAllGoalsAssignedToUser: jest.fn(), uploadNewGoal: jest.fn() }))
jest.mock('../Firestore/contactsFirestore', () => ({ getProjectContacts: jest.fn(), uploadNewContact: jest.fn() }))
jest.mock('../Firestore/assistantsFirestore', () => ({
    getGlobalAssistants: jest.fn(async () => []),
    updateAssistantData: jest.fn(),
    GLOBAL_PROJECT_ID: 'globalProject',
    getProjectAssistants: jest.fn(async () => []),
    uploadNewAssistant: jest.fn(),
}))
jest.mock('../Tasks/tasksFirestoreCloud', () => ({ uploadTask: jest.fn() }))
jest.mock('../Feeds/globalFeedsHelper', () => ({ cleanGlobalFeeds: jest.fn() }))
jest.mock('../Firestore/generalFirestoreCloud', () => ({ getFirebaseTimestampDirectly: jest.fn(), getId: jest.fn() }))

const templatesFirestore = require('../Firestore/templatesFirestore')
const { getAllGoalsAssignedToUser } = require('../Goals/goalsFirestore')
const { getProjectContacts } = require('../Firestore/contactsFirestore')
const { getTemplateObjects, selectFollowedNotesAndObjectNotes } = require('./TemplatesHelper')

const ids = items => items.map(item => item.id || item.uid)

describe('getTemplateObjects', () => {
    test('drops tasks, goals and contacts the template creator cannot see', async () => {
        templatesFirestore.getMainOpenTasks.mockResolvedValue([
            { id: 'shared', isPublicFor: [0] },
            { id: 'creatorPrivate', isPublicFor: ['creator'] },
            { id: 'adminPrivate', isPublicFor: ['admin'] },
        ])
        getAllGoalsAssignedToUser.mockResolvedValue([
            { id: 'g-shared', isPublicFor: [0], completionMilestoneDate: Number.MAX_SAFE_INTEGER },
            { id: 'g-admin', isPublicFor: ['admin'], completionMilestoneDate: Number.MAX_SAFE_INTEGER },
        ])
        templatesFirestore.getAllNotes.mockResolvedValue([])
        getProjectContacts.mockResolvedValue([
            { uid: 'c-shared', isPublicFor: [0] },
            { uid: 'c-admin', isPublicFor: ['admin'] },
        ])
        templatesFirestore.getListFollowedContacts.mockResolvedValue({ 'c-shared': true, 'c-admin': true })

        const result = await getTemplateObjects({}, 'template1', 'creator', false, [])

        expect(ids(result.tasks)).toEqual(['shared', 'creatorPrivate'])
        expect(ids(result.contacts)).toEqual(['c-shared'])
        expect(getAllGoalsAssignedToUser).toHaveBeenCalledWith('template1', 'creator')
    })
})

describe('selectFollowedNotesAndObjectNotes', () => {
    test('never copies a note the creator cannot see, even on a copied task', () => {
        const notes = [
            {
                id: 'onTaskShared',
                parentObject: { id: 't1', type: 'tasks' },
                isPublicFor: [0],
                isVisibleInFollowedFor: [],
            },
            {
                id: 'onTaskAdmin',
                parentObject: { id: 't1', type: 'tasks' },
                isPublicFor: ['admin'],
                isVisibleInFollowedFor: [],
            },
            { id: 'followed', parentObject: null, isPublicFor: [0], isVisibleInFollowedFor: ['creator'] },
        ]
        const selected = selectFollowedNotesAndObjectNotes('creator', notes, { t1: { id: 'new' } }, {}, {}, {})
        expect(ids(selected)).toEqual(['onTaskShared', 'followed'])
    })
})
