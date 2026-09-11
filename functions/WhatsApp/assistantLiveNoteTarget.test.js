const { getCallNotePage, resolveCallContactNote } = require('./assistantLiveNoteTarget')

const pageContext = { path: '/projects/p/contacts/contact-1/note' }
let docs, db
beforeEach(() => {
    docs = new Map([
        ['users/u', {}],
        ['projects/p', { userIds: ['u'] }],
        ['projectsContacts/p/contacts/contact-1', { noteId: 'note-1', isPublicFor: [0] }],
        ['noteItems/p/notes/note-1', { isPublicFor: ['u'] }],
    ])
    const doc = path => ({ get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) })
    db = { doc: jest.fn(doc), collection: name => ({ doc: id => doc(`${name}/${id}`) }) }
})

test.each(['contacts', 'user'])('resolves the stored note ID from the %s note route', async type => {
    await expect(
        resolveCallContactNote({ db, userId: 'u', pageContext: { path: `/projects/p/${type}/contact-1/note` } })
    ).resolves.toEqual({
        projectId: 'p',
        contactId: 'contact-1',
        noteId: 'note-1',
    })
    expect(db.doc).not.toHaveBeenCalledWith('noteItems/p/notes/contact-1')
})

test.each([
    '/projects/p/notes/note-1/editor',
    '/projects/p/user/u/notes/all',
    '/projects/p/contacts/contact-1/backlinks/notes',
    '/projects/tasks/open',
])('does not reinterpret an unrelated page: %s', path => {
    expect(getCallNotePage({ path })).toBeNull()
})

test.each([
    ['projects/p', { userIds: [] }, 'access to this project'],
    ['projectsContacts/p/contacts/contact-1', { noteId: 'note-1', isPublicFor: ['other'] }, 'access to this contact'],
    ['noteItems/p/notes/note-1', { isPublicFor: ['other'] }, 'access to this note'],
    ['projectsContacts/p/contacts/contact-1', { isPublicFor: [0] }, 'no attached note'],
    [
        'projectsContacts/p/contacts/contact-1',
        { noteId: '../secret', isPublicFor: [0] },
        'invalid attached note reference',
    ],
])('does not bypass access or guess a replacement: %s', async (path, value, error) => {
    docs.set(path, value)
    await expect(resolveCallContactNote({ db, userId: 'u', pageContext })).rejects.toThrow(error)
})

test('does not search for or create a replacement when the linked note is missing', async () => {
    docs.delete('noteItems/p/notes/note-1')
    await expect(resolveCallContactNote({ db, userId: 'u', pageContext })).rejects.toThrow(
        'attached note was not found'
    )
})

test('does not treat a real user route as a contact when no contact exists', async () => {
    docs.delete('projectsContacts/p/contacts/contact-1')
    await expect(resolveCallContactNote({ db, userId: 'u', pageContext })).resolves.toBeNull()
})
