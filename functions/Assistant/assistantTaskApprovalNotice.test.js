'use strict'

jest.mock('firebase-admin', () => ({ firestore: () => null }))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { arrayUnion: (...ids) => ({ arrayUnion: ids }) } }))

const { notifyAssistantTaskNeedsApproval, __private__ } = require('./assistantTaskApprovalNotice')

function makeDb(docs) {
    return {
        doc: path => ({
            path,
            get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
            set: async data => docs.set(path, data),
            update: async patch => docs.set(path, { ...docs.get(path), ...patch }),
        }),
    }
}

const baseArgs = docs => {
    const db = makeDb(docs)
    return {
        db,
        taskRef: db.doc('assistantTasks/p1/a/t'),
        task: { id: 't', name: 'Daily digest' },
        taskProjectId: 'p1',
        assistantId: 'a',
        userId: 'u',
        userData: { language: 'de' },
        hash: 'abc123',
        now: 1,
        storeAssistantMessageInTopicOnce: jest.fn(async () => ({ stored: true })),
        getBaseUrl: () => 'https://my.alldone.app',
    }
}

test('posts one private notice per changed content and remembers it on the task', async () => {
    const docs = new Map([
        ['projects/p1', { userIds: ['u'] }],
        ['assistantTasks/p1/a/t', { name: 'Daily digest' }],
    ])
    const args = baseArgs(docs)
    await expect(notifyAssistantTaskNeedsApproval(args)).resolves.toMatchObject({ notified: true })
    const chat = docs.get('chatObjects/p1/chats/AssistantTaskApproval_t_u')
    expect(chat).toMatchObject({ isPublicFor: ['u'], assistantId: 'a', usersFollowing: ['u'] })
    expect(args.storeAssistantMessageInTopicOnce.mock.calls[0][0].responseText).toContain(
        'https://my.alldone.app/projects/p1/assistants/a/customizations'
    )
    expect(args.storeAssistantMessageInTopicOnce.mock.calls[0][0].responseText).toContain('„Daily digest“')
    expect(docs.get('chatNotifications/p1/u/assistant-task-approval-abc123')).toMatchObject({ chatType: 'topics' })
    expect(docs.get('assistantTasks/p1/a/t')['contentApprovalNoticeByUser.u']).toBe('abc123')

    const again = baseArgs(docs)
    again.task = { ...again.task, contentApprovalNoticeByUser: { u: 'abc123' } }
    await expect(notifyAssistantTaskNeedsApproval(again)).resolves.toMatchObject({ reason: 'already_notified' })
    expect(again.storeAssistantMessageInTopicOnce).not.toHaveBeenCalled()
})

test('never posts into a project the user no longer belongs to, and never throws', async () => {
    const docs = new Map([['projects/p1', { userIds: ['someone-else'] }]])
    await expect(notifyAssistantTaskNeedsApproval(baseArgs(docs))).resolves.toMatchObject({ reason: 'not_member' })
    const broken = baseArgs(docs)
    broken.db = { doc: () => ({ get: async () => Promise.reject(new Error('boom')) }) }
    await expect(notifyAssistantTaskNeedsApproval(broken)).resolves.toMatchObject({ reason: 'failed' })
})

test('notice texts exist in en, de and es', () => {
    for (const language of ['en', 'de', 'es']) {
        const { title, text } = __private__.buildNotice({ language, taskName: 'X', url: 'https://u' })
        expect(title).toContain('X')
        expect(text).toContain('https://u')
    }
})
