const { resolveContactStatusUpdate } = require('./contactStatusToolHelper')

const project = {
    contactStatuses: {
        connect: { name: 'JTL Connect' },
        cocreation: { name: 'CoCreation - Customer Service' },
    },
}

describe('Kontaktstatus tool resolution', () => {
    test('omitted status leaves it untouched; empty strings clear it', () => {
        expect(resolveContactStatusUpdate({}, project)).toEqual({ success: true, updates: {} })
        for (const args of [{ contactStatusId: '' }, { contactStatusName: ' ' }]) {
            expect(resolveContactStatusUpdate(args, project)).toMatchObject({
                success: true,
                updates: { contactStatusId: null },
            })
        }
    })

    test('resolves exact project-local names regardless of case or whitespace', () => {
        expect(resolveContactStatusUpdate({ contactStatusName: ' jtl  CONNECT ' }, project)).toMatchObject({
            success: true,
            updates: { contactStatusId: 'connect' },
        })
        expect(resolveContactStatusUpdate({ contactStatusId: 'cocreation' }, project)).toMatchObject({
            success: true,
            updates: { contactStatusId: 'cocreation' },
        })
    })

    test.each([
        { contactStatusName: 'Connect' },
        { contactStatusId: 'other-project-status' },
        { contactStatusName: null },
        { contactStatusId: 12 },
        { contactStatusId: 'connect', contactStatusName: 'Other' },
        { contactStatusId: 'connect', contactStatusName: '' },
        { contactStatusId: '', contactStatusName: 'JTL Connect' },
    ])('rejects invalid/conflicting requests and returns available statuses: %j', args => {
        expect(resolveContactStatusUpdate(args, project)).toMatchObject({
            success: false,
            availableContactStatuses: expect.arrayContaining([{ id: 'connect', name: 'JTL Connect' }]),
        })
    })

    test('duplicate names require an ID; a matching ID/name pair disambiguates', () => {
        const duplicates = { contactStatuses: { a: { name: 'Lead' }, b: { name: 'Lead' } } }
        expect(resolveContactStatusUpdate({ contactStatusName: 'Lead' }, duplicates).success).toBe(false)
        expect(
            resolveContactStatusUpdate({ contactStatusId: 'b', contactStatusName: 'lead' }, duplicates)
        ).toMatchObject({ success: true, updates: { contactStatusId: 'b' } })
    })
})
