/**
 * @jest-environment jsdom
 */

import {
    isEmailHandledInMailbox,
    resetEmailCommentReadSyncCooldown,
    syncEmailCommentsReadState,
} from './emailCommentReadSync'
import { fetchEmailLineMessageStates } from './emailLineBackend'
import { markChatCommentsAsRead } from '../Chats/markChatCommentsAsRead'

jest.mock('./emailLineBackend', () => ({ fetchEmailLineMessageStates: jest.fn() }))
jest.mock('../Chats/markChatCommentsAsRead', () => ({ markChatCommentsAsRead: jest.fn() }))

const linkedEmail = (connectionProjectId, messageId, commentId = `c_${messageId}`) => ({
    key: `${connectionProjectId}:${messageId}`,
    connectionProjectId,
    messageId,
    projectId: 'project-1',
    chatId: 'chat-1',
    commentId,
})

const state = (messageId, overrides = {}) => ({
    messageId,
    exists: true,
    unread: true,
    inInbox: true,
    ...overrides,
})

describe('isEmailHandledInMailbox', () => {
    it('treats read, archived and deleted mail as handled', () => {
        expect(isEmailHandledInMailbox(state('m', { unread: false }))).toBe(true)
        // Archived counts even while Gmail still flags the message unread — leaving the inbox is
        // the user saying they are done with it (AT-2376).
        expect(isEmailHandledInMailbox(state('m', { inInbox: false }))).toBe(true)
        expect(isEmailHandledInMailbox(state('m', { exists: false }))).toBe(true)
    })

    it('ignores inbox absence for mail that was never in the user inbox (AT-2376)', () => {
        // The labeling sync auto-archived it itself, so the comment appeared already out of the
        // inbox; and an outgoing message is never in the inbox at all. Only read/deleted counts.
        const archived = state('m', { inInbox: false })
        expect(isEmailHandledInMailbox(archived, { archivedByLabeling: true })).toBe(false)
        expect(isEmailHandledInMailbox(archived, { direction: 'outgoing' })).toBe(false)
        expect(
            isEmailHandledInMailbox(state('m', { inInbox: false, unread: false }), { archivedByLabeling: true })
        ).toBe(true)
    })

    it('leaves an unread inbox mail alone, and never guesses from a missing state', () => {
        expect(isEmailHandledInMailbox(state('m'))).toBe(false)
        expect(isEmailHandledInMailbox(null)).toBe(false)
        expect(isEmailHandledInMailbox({})).toBe(false)
        expect(isEmailHandledInMailbox({ messageId: 'm' })).toBe(false)
    })
})

describe('syncEmailCommentsReadState', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        resetEmailCommentReadSyncCooldown()
        markChatCommentsAsRead.mockResolvedValue(undefined)
    })

    it('marks only the comments whose email the user already handled in Gmail', async () => {
        fetchEmailLineMessageStates.mockResolvedValue([
            state('m_read', { unread: false }),
            state('m_archived', { inInbox: false }),
            state('m_untouched'),
        ])

        const cleared = await syncEmailCommentsReadState([
            linkedEmail('conn-a', 'm_read'),
            linkedEmail('conn-a', 'm_archived'),
            linkedEmail('conn-a', 'm_untouched'),
        ])

        expect(fetchEmailLineMessageStates).toHaveBeenCalledWith('conn-a', ['m_read', 'm_archived', 'm_untouched'])
        expect(cleared).toBe(2)
        expect(markChatCommentsAsRead).toHaveBeenCalledWith([
            { projectId: 'project-1', chatId: 'chat-1', commentId: 'c_m_read' },
            { projectId: 'project-1', chatId: 'chat-1', commentId: 'c_m_archived' },
        ])
    })

    it('clears every chat comment of an email that is linked into more than one topic', async () => {
        fetchEmailLineMessageStates.mockResolvedValue([state('m1', { unread: false })])

        await syncEmailCommentsReadState([
            {
                key: 'conn-a:m1',
                connectionProjectId: 'conn-a',
                messageId: 'm1',
                commentRefs: [
                    { projectId: 'project-1', chatId: 'chat-1', commentId: 'c1' },
                    { projectId: 'project-2', chatId: 'chat-2', commentId: 'c2' },
                ],
            },
        ])

        expect(markChatCommentsAsRead.mock.calls[0][0]).toEqual([
            { projectId: 'project-1', chatId: 'chat-1', commentId: 'c1' },
            { projectId: 'project-2', chatId: 'chat-2', commentId: 'c2' },
        ])
    })

    it('keeps an auto-archived email unread until it is actually read in Gmail', async () => {
        fetchEmailLineMessageStates.mockResolvedValue([state('m_auto', { inInbox: false })])

        const cleared = await syncEmailCommentsReadState([
            { ...linkedEmail('conn-a', 'm_auto'), archivedByLabeling: true },
        ])

        expect(cleared).toBe(0)
        expect(markChatCommentsAsRead).not.toHaveBeenCalled()
    })

    it('asks each mail connection separately', async () => {
        fetchEmailLineMessageStates.mockResolvedValue([])

        await syncEmailCommentsReadState([linkedEmail('conn-a', 'm1'), linkedEmail('conn-b', 'm2')])

        expect(fetchEmailLineMessageStates).toHaveBeenCalledWith('conn-a', ['m1'])
        expect(fetchEmailLineMessageStates).toHaveBeenCalledWith('conn-b', ['m2'])
        expect(markChatCommentsAsRead).not.toHaveBeenCalled()
    })

    it('re-checks a message only after the cooldown, unless forced', async () => {
        fetchEmailLineMessageStates.mockResolvedValue([state('m1')])
        const emails = [linkedEmail('conn-a', 'm1')]

        await syncEmailCommentsReadState(emails)
        await syncEmailCommentsReadState(emails)
        expect(fetchEmailLineMessageStates).toHaveBeenCalledTimes(1)

        // Returning to the tab after handling the mail in Gmail must not wait out the throttle.
        await syncEmailCommentsReadState(emails, { force: true })
        expect(fetchEmailLineMessageStates).toHaveBeenCalledTimes(2)
    })

    it('asks nothing for emails with no chat comment behind them', async () => {
        await syncEmailCommentsReadState([{ key: 'conn-a:m1', connectionProjectId: 'conn-a', messageId: 'm1' }])
        expect(fetchEmailLineMessageStates).not.toHaveBeenCalled()
    })

    it('keeps the comment unread while the app is offline', async () => {
        // The callable funnel fails fast offline with a typed error rather than hanging, which is
        // the same "we could not ask" path every other failure takes.
        const offline = new Error('You are offline')
        offline.code = 'offline'
        fetchEmailLineMessageStates.mockRejectedValue(offline)

        await expect(syncEmailCommentsReadState([linkedEmail('conn-a', 'm1')])).resolves.toBe(0)
        expect(markChatCommentsAsRead).not.toHaveBeenCalled()
    })

    it('keeps the comment unread when the mailbox cannot be read', async () => {
        fetchEmailLineMessageStates.mockRejectedValue(new Error('EMAIL_AUTH_EXPIRED'))

        await expect(syncEmailCommentsReadState([linkedEmail('conn-a', 'm1')])).resolves.toBe(0)
        expect(markChatCommentsAsRead).not.toHaveBeenCalled()

        // A failed lookup must not be remembered as checked, or a reconnect would take a minute
        // to have any effect.
        fetchEmailLineMessageStates.mockResolvedValue([state('m1', { unread: false })])
        await syncEmailCommentsReadState([linkedEmail('conn-a', 'm1')])
        expect(markChatCommentsAsRead).toHaveBeenCalled()
    })

    it('never lets a failed notification write look like success', async () => {
        fetchEmailLineMessageStates.mockResolvedValue([state('m1', { unread: false })])
        markChatCommentsAsRead.mockRejectedValue(new Error('offline'))

        await expect(syncEmailCommentsReadState([linkedEmail('conn-a', 'm1')])).resolves.toBe(0)
    })
})
