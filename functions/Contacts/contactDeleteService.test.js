const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { ContactDeleteError, deleteContact } = require('./contactDeleteService')

const P = 'proj1'
const OWNER = 'karsten'
const MEMBER = 'anna'

const seeded = (contacts = {}) =>
    createFakeFirestore({
        [`projects/${P}`]: { name: 'Alldone Growth', userIds: [OWNER, MEMBER] },
        ...Object.fromEntries(
            Object.entries(contacts).map(([id, data]) => [`projectsContacts/${P}/contacts/${id}`, data])
        ),
    })

describe('delete_contact', () => {
    test('writes the Updates entry first, then deletes the document', async () => {
        const db = seeded({ c1: { displayName: 'Jane Prospect', recorderUserId: OWNER, isPublicFor: [0, OWNER] } })
        const order = []
        const writeDeletedFeed = jest.fn(async contact => {
            order.push(`feed:${db.docs.has(`projectsContacts/${P}/contacts/${contact.uid}`)}`)
        })

        const result = await deleteContact({
            db,
            projectId: P,
            userId: MEMBER,
            args: { contactId: 'c1' },
            writeDeletedFeed,
        })

        expect(result).toMatchObject({
            success: true,
            deleted: true,
            contact: { contactId: 'c1', displayName: 'Jane Prospect' },
        })
        // The feed object is loaded from the contact, so the contact still existed when it was written.
        expect(order).toEqual(['feed:true'])
        expect(writeDeletedFeed).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'c1', displayName: 'Jane Prospect' })
        )
        expect(db.docs.has(`projectsContacts/${P}/contacts/c1`)).toBe(false)
    })

    test('only an exact id deletes: no names, no ids that do not exist, nothing the caller cannot see', async () => {
        const db = seeded({
            c1: { displayName: 'Jane Prospect', recorderUserId: OWNER },
            secret: { displayName: 'Private Person', isPublicFor: [OWNER] },
        })
        await expect(
            deleteContact({ db, projectId: P, userId: OWNER, args: { contactName: 'Jane Prospect' } })
        ).rejects.toThrow(/contactId is required/)
        await expect(deleteContact({ db, projectId: P, userId: OWNER, args: { contactId: 'c2' } })).rejects.toThrow(
            /No contact with id "c2"/
        )
        await expect(
            deleteContact({ db, projectId: P, userId: MEMBER, args: { contactId: 'secret' } })
        ).rejects.toThrow(ContactDeleteError)
        await expect(
            deleteContact({ db, projectId: P, userId: 'stranger', args: { contactId: 'c1' } })
        ).rejects.toThrow(/not a member/)
        expect(db.writes).toHaveLength(0)
    })

    test('a contact without a stored audience is visible to the project, and a failed Updates entry does not stop the delete', async () => {
        const db = seeded({ c1: { displayName: 'Old Contact', recorderUserId: OWNER } })
        const result = await deleteContact({
            db,
            projectId: P,
            userId: MEMBER,
            args: { contactId: 'c1' },
            writeDeletedFeed: async () => {
                throw new Error('feed down')
            },
        })
        expect(result.deleted).toBe(true)
        expect(result.warnings[0]).toMatch(/feed down/)
        expect(db.docs.has(`projectsContacts/${P}/contacts/c1`)).toBe(false)
    })
})
