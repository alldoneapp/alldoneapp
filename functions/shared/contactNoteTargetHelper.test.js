jest.mock('../Email/emailChannelHelpers', () => ({
    normalizeEmailAddress: value => {
        const normalized = String(value || '').trim()
        const angleMatch = normalized.match(/<([^>]+)>/)
        const candidate = angleMatch?.[1] || normalized
        return String(candidate || '')
            .trim()
            .toLowerCase()
    },
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 'public',
}))

const { findMatchingContacts, resolveContactNoteTarget, resolveContactTarget } = require('./contactNoteTargetHelper')

function createDb(initialDocs = {}) {
    const docs = { ...initialDocs }
    let generatedIdCounter = 1

    return {
        docs,
        collection(path) {
            if (path === '_') {
                return {
                    doc() {
                        const id = `generated-${generatedIdCounter++}`
                        return { id }
                    },
                }
            }

            return {
                async get() {
                    const prefix = `${path}/`
                    const results = Object.entries(docs)
                        .filter(([docPath]) => docPath.startsWith(prefix))
                        .map(([docPath, data]) => ({
                            id: docPath.slice(prefix.length),
                            data: () => data,
                        }))
                    return { docs: results }
                },
            }
        },
        doc(path) {
            return {
                async get() {
                    return {
                        exists: docs[path] !== undefined,
                        data: () => docs[path],
                    }
                },
                async update(updateData) {
                    docs[path] = { ...(docs[path] || {}), ...updateData }
                },
                async set(value) {
                    docs[path] = value
                },
            }
        },
    }
}

describe('contactNoteTargetHelper matching', () => {
    test('exact email match beats exact and fuzzy name matches', () => {
        const contacts = [
            { uid: '1', displayName: 'Alice Example', email: 'other@example.com', lastEditionDate: 10 },
            { uid: '2', displayName: 'Alicia Example', email: 'alice@example.com', lastEditionDate: 20 },
        ]

        const result = findMatchingContacts(contacts, {
            contactName: 'Alice Example',
            contactEmail: 'alice@example.com',
        })

        expect(result.selectedContact.uid).toBe('2')
        expect(result.matchType).toBe('email')
        expect(result.autoPicked).toBe(false)
    })

    test('exact name match beats fuzzy name matching', () => {
        const contacts = [
            { uid: '1', displayName: 'John Smith', email: '', lastEditionDate: 10 },
            { uid: '2', displayName: 'Jon Smith', email: '', lastEditionDate: 20 },
        ]

        const result = findMatchingContacts(contacts, {
            contactName: 'John Smith',
            contactEmail: 'john@example.com',
        })

        expect(result.selectedContact.uid).toBe('1')
        expect(result.matchType).toBe('exact_name')
    })

    test('fuzzy name matching only runs when inbound email is available', () => {
        const contacts = [{ uid: '1', displayName: 'Jon Smith', email: '', lastEditionDate: 10 }]

        const resultWithoutEmail = findMatchingContacts(contacts, {
            contactName: 'John Smith',
        })
        const resultWithEmail = findMatchingContacts(contacts, {
            contactName: 'John Smith',
            contactEmail: 'john@example.com',
        })

        expect(resultWithoutEmail.selectedContact).toBeNull()
        expect(resultWithEmail.selectedContact.uid).toBe('1')
        expect(resultWithEmail.matchType).toBe('fuzzy_name')
    })

    test('fuzzy name below threshold does not match', () => {
        const contacts = [{ uid: '1', displayName: 'Completely Different', email: '', lastEditionDate: 10 }]

        const result = findMatchingContacts(contacts, {
            contactName: 'John Smith',
            contactEmail: 'john@example.com',
        })

        expect(result.selectedContact).toBeNull()
        expect(result.matchType).toBeNull()
    })

    test('highest fuzzy score is auto-picked', () => {
        const contacts = [
            { uid: '1', displayName: 'John Smit', email: '', lastEditionDate: 10 },
            { uid: '2', displayName: 'Jon Smith', email: '', lastEditionDate: 20 },
        ]

        const result = findMatchingContacts(contacts, {
            contactName: 'John Smith',
            contactEmail: 'john@example.com',
        })

        expect(result.selectedContact.uid).toBe('2')
        expect(result.matchType).toBe('fuzzy_name')
        expect(result.autoPicked).toBe(true)
        expect(result.matchScore).toBeGreaterThan(0.8)
    })

    test('exact duplicate matches auto-pick deterministically by recency', () => {
        const contacts = [
            { uid: '1', displayName: 'Jane Doe', email: '', lastEditionDate: 10 },
            { uid: '2', displayName: 'Jane Doe', email: '', lastEditionDate: 20 },
        ]

        const result = findMatchingContacts(contacts, {
            contactName: 'Jane Doe',
            contactEmail: 'jane@example.com',
        })

        expect(result.selectedContact.uid).toBe('2')
        expect(result.matchType).toBe('exact_name')
        expect(result.autoPicked).toBe(true)
    })
})

describe('contactNoteTargetHelper resolution', () => {
    test('resolveContactTarget creates contact when missing and createIfMissing is true', async () => {
        const db = createDb()

        const result = await resolveContactTarget({
            db,
            projectId: 'project-1',
            userId: 'user-1',
            contactName: 'Taylor Swift',
            contactEmail: 'taylor@example.com',
            createIfMissing: true,
        })

        expect(result.success).toBe(true)
        expect(result.contactCreated).toBe(true)
        expect(result.matchType).toBe('created')
        expect(result.contact.displayName).toBe('Taylor Swift')
        expect(result.contact.email).toBe('taylor@example.com')
    })

    test('resolveContactTarget returns no match when createIfMissing is false', async () => {
        const db = createDb()

        const result = await resolveContactTarget({
            db,
            projectId: 'project-1',
            userId: 'user-1',
            contactName: 'Missing Person',
            contactEmail: 'missing@example.com',
            createIfMissing: false,
        })

        expect(result.success).toBe(false)
        expect(result.error).toBe('NO_CONTACT_MATCH')
    })

    test('resolveContactNoteTarget reuses existing note for fuzzy-matched contact', async () => {
        const db = createDb({
            'projectsContacts/project-1/contacts/contact-1': {
                displayName: 'Jon Smith',
                email: '',
                noteId: 'note-1',
                isPrivate: false,
                isPublicFor: ['public', 'user-1'],
                recorderUserId: 'user-1',
                lastEditionDate: 100,
            },
            'noteItems/project-1/notes/note-1': {
                title: 'Jon Smith',
                content: 'existing note',
            },
        })

        const noteService = {
            createAndPersistNote: jest.fn(),
        }

        const result = await resolveContactNoteTarget({
            db,
            noteService,
            feedUser: { uid: 'user-1', displayName: 'User' },
            userId: 'user-1',
            projectId: 'project-1',
            contactName: 'John Smith',
            contactEmail: 'john@example.com',
            createIfMissing: true,
        })

        expect(result.success).toBe(true)
        expect(result.contact.uid).toBe('contact-1')
        expect(result.note.id).toBe('note-1')
        expect(result.noteCreated).toBe(false)
        expect(result.matchType).toBe('fuzzy_name')
        expect(noteService.createAndPersistNote).not.toHaveBeenCalled()
    })
})
