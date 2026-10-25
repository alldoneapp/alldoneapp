/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import useLinkedEmailArchive from './useLinkedEmailArchive'
import { performEmailLineAction } from '../../../utils/backends/EmailLine/emailLineBackend'
import { clearChatCommentsForLinkedEmails } from '../../../utils/backends/Chats/markChatCommentsAsRead'

jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    clearChatCommentsForLinkedEmails: jest.fn(),
}))

const restoreUnreadState = jest.fn()
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))

const email = (connectionProjectId, messageId) => ({
    key: `${connectionProjectId}:${messageId}`,
    connectionProjectId,
    messageId,
})

let hook

function Harness() {
    hook = useLinkedEmailArchive()
    return <Text>{hook.archivingEmailKeys.join(',')}</Text>
}

const render = () => {
    let tree
    act(() => {
        tree = renderer.create(<Harness />)
    })
    return tree
}

describe('useLinkedEmailArchive', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        performEmailLineAction.mockResolvedValue({})
        clearChatCommentsForLinkedEmails.mockResolvedValue(restoreUnreadState)
    })

    it('archives one email through the email backend and remembers it as archived', async () => {
        render()

        await act(async () => {
            await hook.archiveLinkedEmails([email('connection-1', 'msg-1')])
        })

        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'archive',
            messageIds: ['msg-1'],
        })
        expect(performEmailLineAction).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: 'markRead' })
        )
        expect(clearChatCommentsForLinkedEmails).toHaveBeenCalledWith([email('connection-1', 'msg-1')])
        expect(hook.isArchivedEmail('connection-1:msg-1')).toBe(true)
        expect(hook.isArchivingEmail('connection-1:msg-1')).toBe(false)
    })

    it('groups a batch into one call per connection', async () => {
        render()

        await act(async () => {
            await hook.archiveLinkedEmails([
                email('connection-1', 'msg-1'),
                email('connection-1', 'msg-2'),
                email('connection-2', 'msg-3'),
            ])
        })

        expect(performEmailLineAction).toHaveBeenCalledTimes(2)
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'archive',
            messageIds: ['msg-1', 'msg-2'],
        })
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-2', {
            action: 'archive',
            messageIds: ['msg-3'],
        })
        expect(clearChatCommentsForLinkedEmails).toHaveBeenCalledTimes(1)
    })

    // AT-2424: the button says "Archived" from the press, not from the Gmail answer 4-8s later.
    // The unread state is already gone by then, so a spinner here would be the last thing on
    // screen still claiming the work had not happened.
    it('reports the email as archived immediately, while the mailbox call is still running', async () => {
        let resolveCall
        performEmailLineAction.mockReturnValue(new Promise(resolve => (resolveCall = resolve)))
        render()

        let pending
        await act(async () => {
            pending = hook.archiveLinkedEmails([email('connection-1', 'msg-1')])
        })

        expect(hook.isArchivedEmail('connection-1:msg-1')).toBe(true)
        // Still the honest in-flight truth underneath, which is what keeps two bulk runs from
        // overlapping; the renderers just check `archived` first.
        expect(hook.isArchivingEmail('connection-1:msg-1')).toBe(true)

        await act(async () => {
            resolveCall({})
            await pending
        })
        expect(hook.isArchivedEmail('connection-1:msg-1')).toBe(true)
        expect(hook.isArchivingEmail('connection-1:msg-1')).toBe(false)
    })

    it('never archives the same email twice', async () => {
        render()

        await act(async () => {
            await hook.archiveLinkedEmails([email('connection-1', 'msg-1')])
        })
        await act(async () => {
            await hook.archiveLinkedEmails([email('connection-1', 'msg-1')])
        })

        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
        expect(clearChatCommentsForLinkedEmails).toHaveBeenCalledTimes(1)
    })

    it('clears the in-flight state when the call fails, so the button stays usable', async () => {
        performEmailLineAction.mockRejectedValue(new Error('nope'))
        jest.spyOn(console, 'error').mockImplementation(() => {})
        window.alert = jest.fn()
        render()

        await act(async () => {
            await hook.archiveLinkedEmails([email('connection-1', 'msg-1')])
        })

        expect(hook.isArchivingEmail('connection-1:msg-1')).toBe(false)
        expect(hook.isArchivedEmail('connection-1:msg-1')).toBe(false)
        expect(window.alert).toHaveBeenCalled()
    })

    // The optimistic flip has to be undone with the unread state it was standing in for (AT-2424),
    // or the email comes back into the list next to a button still saying "Archived".
    it('takes the optimistic "Archived" back when the mailbox archive fails, and can retry', async () => {
        performEmailLineAction.mockRejectedValueOnce(new Error('nope'))
        jest.spyOn(console, 'error').mockImplementation(() => {})
        window.alert = jest.fn()
        render()

        let failed
        await act(async () => {
            failed = await hook.archiveLinkedEmails([email('connection-1', 'msg-1')])
        })

        expect(failed).toBe(false)
        expect(hook.isArchivedEmail('connection-1:msg-1')).toBe(false)
        // Recorded here, not in the button: the previewed row (and the bulk button with it) has
        // already unmounted by the time this failure arrives.
        expect(hook.isFailedEmail('connection-1:msg-1')).toBe(true)

        performEmailLineAction.mockResolvedValueOnce({})
        let retried
        await act(async () => {
            retried = await hook.archiveLinkedEmails([email('connection-1', 'msg-1')])
        })

        expect(retried).toBe(true)
        expect(hook.isArchivedEmail('connection-1:msg-1')).toBe(true)
        expect(hook.isFailedEmail('connection-1:msg-1')).toBe(false)
        expect(performEmailLineAction).toHaveBeenCalledTimes(2)
    })

    it('ignores an empty batch and entries with no key', async () => {
        render()

        await act(async () => {
            await hook.archiveLinkedEmails([])
            await hook.archiveLinkedEmails(undefined)
            await hook.archiveLinkedEmails([{ connectionProjectId: 'connection-1', messageId: 'msg-1' }])
        })

        expect(performEmailLineAction).not.toHaveBeenCalled()
    })
})
