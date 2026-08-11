/**
 * @jest-environment jsdom
 */

import React from 'react'
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import ArchiveUnreadEmailsButton from './ArchiveUnreadEmailsButton'
import { UnreadEmailArchiveProvider, useRegisterUnreadLinkedEmails } from './unreadEmailArchiveContext'
import { performEmailLineAction } from '../../utils/backends/EmailLine/emailLineBackend'
import { markMessagesAsRead } from '../../utils/backends/Chats/chatsComments'

jest.mock('../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))

jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    markMessagesAsRead: jest.fn(),
    markChatMessagesAsRead: jest.fn(),
}))

jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

const email = (connectionProjectId, messageId) => ({
    key: `${connectionProjectId}:${messageId}`,
    connectionProjectId,
    messageId,
})

// Stands in for a mounted unread preview: the rows are what publish "these emails are on screen",
// and this is the smallest thing that does the same.
const PreviewRegistration = ({ sourceKey, projectId, linkedEmails }) => {
    useRegisterUnreadLinkedEmails(sourceKey, projectId, linkedEmails)
    return null
}

const renderButton = ({ projectId, registrations = [] }) => {
    let tree
    act(() => {
        tree = renderer.create(
            <UnreadEmailArchiveProvider>
                {registrations.map(registration => (
                    <PreviewRegistration key={registration.sourceKey} {...registration} />
                ))}
                <ArchiveUnreadEmailsButton projectId={projectId} />
            </UnreadEmailArchiveProvider>
        )
    })
    return tree
}

const buttonOf = tree => tree.root.findAllByType(TouchableOpacity)[0]
// The icon renders a glyph from a private-use code point through a <Text> of its own; only the
// readable label is interesting here.
const labelsOf = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => node.props.children)
        .filter(text => typeof text === 'string' && /^[\x20-\x7e]+$/.test(text))

const archivePayloads = () => performEmailLineAction.mock.calls.map(([projectId, payload]) => [projectId, payload])

describe('ArchiveUnreadEmailsButton visibility', () => {
    beforeEach(() => jest.clearAllMocks())

    it('renders nothing outside the chat list, where there is no preview registry at all', () => {
        let tree
        act(() => {
            tree = renderer.create(<ArchiveUnreadEmailsButton projectId="project-1" />)
        })

        expect(tree.toJSON()).toBeNull()
    })

    it('renders nothing while no previewed message has an email behind it', () => {
        const tree = renderButton({
            projectId: 'project-1',
            registrations: [{ sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [] }],
        })

        expect(tree.toJSON()).toBeNull()
    })

    it('stays hidden for a project whose previews hold no email, while another project has some', () => {
        const tree = renderButton({
            projectId: 'project-2',
            registrations: [
                { sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [email('conn-a', 'm1')] },
            ],
        })

        expect(tree.toJSON()).toBeNull()
    })

    it('is hidden for a viewer who is not a project member, because a preview publishes nothing', () => {
        // The preview only registers its emails when SharedHelper.accessGranted passes (see
        // ChatItemUnreadMessages); a non-member therefore leaves the scope empty, which is what
        // keeps the bulk action off the header rather than a second permission check here.
        const tree = renderButton({
            projectId: 'project-1',
            registrations: [{ sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [] }],
        })

        expect(tree.toJSON()).toBeNull()
    })

    it('appears as soon as a preview publishes an email', () => {
        const tree = renderButton({
            projectId: 'project-1',
            registrations: [
                { sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [email('conn-a', 'm1')] },
            ],
        })

        expect(labelsOf(tree)).toEqual(['Archive emails'])
    })

    it('disappears again when the last preview holding an email unmounts', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <UnreadEmailArchiveProvider>
                    <PreviewRegistration
                        sourceKey="project-1:chat-1"
                        projectId="project-1"
                        linkedEmails={[email('conn-a', 'm1')]}
                    />
                    <ArchiveUnreadEmailsButton projectId="project-1" />
                </UnreadEmailArchiveProvider>
            )
        })
        expect(tree.toJSON()).not.toBeNull()

        act(() => {
            tree.update(
                <UnreadEmailArchiveProvider>
                    <ArchiveUnreadEmailsButton projectId="project-1" />
                </UnreadEmailArchiveProvider>
            )
        })

        expect(tree.toJSON()).toBeNull()
    })
})

describe('ArchiveUnreadEmailsButton scope', () => {
    beforeEach(() => jest.clearAllMocks())

    const twoProjects = [
        {
            sourceKey: 'project-1:chat-1',
            projectId: 'project-1',
            linkedEmails: [email('conn-a', 'm1'), email('conn-a', 'm2')],
        },
        { sourceKey: 'project-2:chat-9', projectId: 'project-2', linkedEmails: [email('conn-b', 'm3')] },
    ]

    it('archives only its own project from a project line', async () => {
        performEmailLineAction.mockResolvedValue(undefined)
        const tree = renderButton({ projectId: 'project-1', registrations: twoProjects })

        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(archivePayloads()).toEqual([['conn-a', { action: 'archive', messageIds: ['m1', 'm2'] }]])
    })

    it('archives every project from the All Projects line, and says so', async () => {
        performEmailLineAction.mockResolvedValue(undefined)
        const tree = renderButton({ projectId: undefined, registrations: twoProjects })

        expect(labelsOf(tree)).toEqual(['Archive all emails'])

        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(archivePayloads()).toEqual([
            ['conn-a', { action: 'archive', messageIds: ['m1', 'm2'] }],
            ['conn-b', { action: 'archive', messageIds: ['m3'] }],
        ])
    })

    it('archives an email previewed by two topics exactly once', async () => {
        performEmailLineAction.mockResolvedValue(undefined)
        const tree = renderButton({
            projectId: 'project-1',
            registrations: [
                { sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [email('conn-a', 'm1')] },
                {
                    sourceKey: 'project-1:chat-2',
                    projectId: 'project-1',
                    linkedEmails: [email('conn-a', 'm1'), email('conn-a', 'm2')],
                },
            ],
        })

        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(archivePayloads()).toEqual([['conn-a', { action: 'archive', messageIds: ['m1', 'm2'] }]])
    })

    it('archives an email previewed in two projects exactly once from All Projects', async () => {
        performEmailLineAction.mockResolvedValue(undefined)
        const tree = renderButton({
            projectId: undefined,
            registrations: [
                { sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [email('conn-a', 'm1')] },
                { sourceKey: 'project-2:chat-1', projectId: 'project-2', linkedEmails: [email('conn-a', 'm1')] },
            ],
        })

        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(archivePayloads()).toEqual([['conn-a', { action: 'archive', messageIds: ['m1'] }]])
    })

    it('never marks anything as read - archiving is a mailbox action', async () => {
        performEmailLineAction.mockResolvedValue(undefined)
        const tree = renderButton({
            projectId: 'project-1',
            registrations: [
                { sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [email('conn-a', 'm1')] },
            ],
        })

        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(markMessagesAsRead).not.toHaveBeenCalled()
    })
})

describe('ArchiveUnreadEmailsButton states', () => {
    beforeEach(() => jest.clearAllMocks())

    const oneEmail = [{ sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [email('conn-a', 'm1')] }]

    it('shows a spinner and refuses a second press while the archive is in flight', async () => {
        let finishArchive
        performEmailLineAction.mockImplementation(() => new Promise(resolve => (finishArchive = resolve)))
        const tree = renderButton({ projectId: 'project-1', registrations: oneEmail })

        let archivePromise
        act(() => {
            archivePromise = buttonOf(tree).props.onPress()
        })

        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1)
        expect(buttonOf(tree).props.disabled).toBe(true)
        expect(buttonOf(tree).props.accessibilityState).toEqual({ busy: true, disabled: true })

        act(() => {
            buttonOf(tree).props.onPress()
        })
        expect(performEmailLineAction).toHaveBeenCalledTimes(1)

        await act(async () => {
            finishArchive()
            await archivePromise
        })
    })

    it('settles into a completed state once everything in scope is archived', async () => {
        performEmailLineAction.mockResolvedValue(undefined)
        const tree = renderButton({ projectId: 'project-1', registrations: oneEmail })

        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(labelsOf(tree)).toEqual(['Archived'])
        expect(buttonOf(tree).props.disabled).toBe(true)
        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0)
    })

    it('never sends an already archived email again', async () => {
        performEmailLineAction.mockResolvedValue(undefined)
        const tree = renderButton({ projectId: 'project-1', registrations: oneEmail })

        await act(async () => {
            await buttonOf(tree).props.onPress()
        })
        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
    })

    it('offers a retry when the archive call fails, without an alert on top of it', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})
        performEmailLineAction.mockRejectedValueOnce(new Error('offline'))
        const tree = renderButton({ projectId: 'project-1', registrations: oneEmail })

        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(labelsOf(tree)).toEqual(['try again'])
        expect(buttonOf(tree).props.accessibilityLabel).toBe("Emails couldn't be archived. Try again")
        expect(buttonOf(tree).props.disabled).toBe(false)
        expect(alertSpy).not.toHaveBeenCalled()

        performEmailLineAction.mockResolvedValueOnce(undefined)
        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(labelsOf(tree)).toEqual(['Archived'])
        consoleError.mockRestore()
        alertSpy.mockRestore()
    })
})
