'use strict'

// Security audit 2026-11 (#11): a removed member must leave the follower lists comment
// notifications fan out to, not only the chat object's usersFollowing.

jest.mock('../Tasks/onDeleteTaskFunctions', () => ({ deleteSubTaskFromParent: jest.fn() }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({}))
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { arrayRemove: (...ids) => ({ arrayRemove: ids }) },
}))

const { processFollowers } = require('./onKickUserFromProject')

test('removes the member from every followers list of the project and drops their followed index', async () => {
    const lists = {
        tasks: { t1: ['kicked', 'stays'], t2: ['stays'] },
        notes: { n1: ['kicked'] },
    }
    const updates = []
    const deletes = []
    const collection = type => ({
        where: (field, op, value) => {
            expect([field, op]).toEqual(['usersFollowing', 'array-contains'])
            return {
                get: async () => ({
                    forEach: callback =>
                        Object.entries(lists[type])
                            .filter(([, ids]) => ids.includes(value))
                            .forEach(([id]) =>
                                callback({
                                    ref: { update: async data => updates.push([`${type}/${id}`, data]) },
                                })
                            ),
                }),
            }
        },
    })
    const admin = {
        firestore: () => ({
            doc: path => ({
                listCollections: async () => Object.keys(lists).map(collection),
                delete: async () => deletes.push(path),
            }),
        }),
    }

    await processFollowers('project-1', 'kicked', admin)

    expect(updates.sort()).toEqual([
        ['notes/n1', { usersFollowing: { arrayRemove: ['kicked'] } }],
        ['tasks/t1', { usersFollowing: { arrayRemove: ['kicked'] } }],
    ])
    expect(deletes).toEqual(['usersFollowing/project-1/entries/kicked'])
})
