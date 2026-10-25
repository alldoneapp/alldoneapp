const { getEmailIdentity, matchesEmailAccount, matchesEmailThread } = require('./emailThreadIdentity')

const data = { gmailEmail: 'Karsten@Example.com', messageId: 'message-1', threadId: 'thread-1' }

test('thread keys span messages and connection/project changes, but separate accounts, users and providers', () => {
    const identity = getEmailIdentity('user-1', data)
    expect(
        getEmailIdentity('user-1', {
            ...data,
            gmailEmail: ' karsten@example.com ',
            messageId: 'message-2',
            projectId: 'other',
        }).key
    ).toBe(identity.key)
    for (const changed of [{ gmailEmail: 'other@example.com' }, { provider: 'microsoft' }, { threadId: 'Thread-1' }]) {
        expect(getEmailIdentity('user-1', { ...data, ...changed }).key).not.toBe(identity.key)
    }
    expect(getEmailIdentity('user-2', data).key).not.toBe(identity.key)
    expect(getEmailIdentity('user-1', { ...data, messageId: 'message-2' }).messageKey).not.toBe(identity.messageKey)
})

test('messages with missing thread IDs remain separate; ambiguous account data is refused', () => {
    expect(getEmailIdentity('user-1', { ...data, threadId: '' }).key).not.toBe(
        getEmailIdentity('user-1', { ...data, threadId: '', messageId: 'message-2' }).key
    )
    expect(getEmailIdentity('user-1', { ...data, gmailEmail: '' })).toBeNull()
    expect(getEmailIdentity('user-1', { ...data, messageId: '' })).toBeNull()
    expect(getEmailIdentity('user-1', { ...data, provider: 'unknown' })).toBeNull()
})

test('legacy Gmail linkage matches only a proven account and exact thread', () => {
    const identity = getEmailIdentity('user-1', data)
    expect(matchesEmailThread({ ...data, messageId: 'older-message' }, identity)).toBe(true)
    expect(matchesEmailThread({ ...data, threadId: 'different' }, identity)).toBe(false)
    expect(matchesEmailThread({ ...data, gmailEmail: '' }, identity)).toBe(false)
    expect(matchesEmailAccount({ ...data, accountUserId: 'other' }, identity)).toBe(false)
    expect(matchesEmailAccount({ ...data, provider: 'microsoft' }, identity)).toBe(false)
    const messageIdentity = getEmailIdentity('user-1', { ...data, threadId: '' })
    expect(matchesEmailThread({ ...data, messageId: 'other', messageIds: ['message-1'] }, messageIdentity)).toBe(true)
})
