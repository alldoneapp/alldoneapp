/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import useLinkedEmailArchive from './useLinkedEmailArchive'
import { performEmailLineAction } from '../../../utils/backends/EmailLine/emailLineBackend'

jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
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
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'markRead',
            messageIds: ['msg-1'],
        })
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

        expect(performEmailLineAction).toHaveBeenCalledTimes(4)
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'archive',
            messageIds: ['msg-1', 'msg-2'],
        })
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'markRead',
            messageIds: ['msg-1', 'msg-2'],
        })
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-2', {
            action: 'archive',
            messageIds: ['msg-3'],
        })
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-2', {
            action: 'markRead',
            messageIds: ['msg-3'],
        })
    })

    it('reports the in-flight state while the call is running', async () => {
        let resolveCall
        performEmailLineAction.mockReturnValue(new Promise(resolve => (resolveCall = resolve)))
        render()

        let pending
        act(() => {
            pending = hook.archiveLinkedEmails([email('connection-1', 'msg-1')])
        })
        expect(hook.isArchivingEmail('connection-1:msg-1')).toBe(true)

        await act(async () => {
            resolveCall({})
            await pending
        })
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

        expect(performEmailLineAction).toHaveBeenCalledTimes(2)
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
