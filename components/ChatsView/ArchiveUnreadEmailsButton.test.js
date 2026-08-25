/**
 * @jest-environment jsdom
 */

import React from 'react'
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'
import { createStore } from 'redux'

import ArchiveUnreadEmailsButton from './ArchiveUnreadEmailsButton'
import { UnreadEmailArchiveProvider, useRegisterUnreadLinkedEmails } from './unreadEmailArchiveContext'
import { performEmailLineAction } from '../../utils/backends/EmailLine/emailLineBackend'
import { markMessagesAsRead } from '../../utils/backends/Chats/chatsComments'
import { clearChatCommentsForLinkedEmails } from '../../utils/backends/Chats/markChatCommentsAsRead'

jest.mock('../../utils/backends/EmailLine/emailLineBackend', () => ({
    performEmailLineAction: jest.fn(),
    // The provider reconciles previewed emails against the mailbox (AT-2376); it must not reach
    // the real callable from a row test.
    fetchEmailLineMessageStates: jest.fn(async () => []),
}))

jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    markMessagesAsRead: jest.fn(),
    markChatMessagesAsRead: jest.fn(),
}))

// The archive clears the unread state of the matching chat comments first and hands back the
// rollback (AT-2424); the restore is what a failed mailbox archive calls.
const restoreUnreadState = jest.fn()
jest.mock('../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    clearChatCommentsForLinkedEmails: jest.fn(),
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

// `smallScreenNavigation` drives the icon-only mobile variant of the button (AT-2263); it is
// undefined - i.e. the desktop, labelled variant - unless a case opts in.
const renderButton = ({ projectId, registrations = [], smallScreenNavigation = false }) => {
    const store = createStore(() => ({ smallScreenNavigation }))
    let tree
    act(() => {
        tree = renderer.create(
            <Provider store={store}>
                <UnreadEmailArchiveProvider>
                    {registrations.map(registration => (
                        <PreviewRegistration key={registration.sourceKey} {...registration} />
                    ))}
                    <ArchiveUnreadEmailsButton projectId={projectId} />
                </UnreadEmailArchiveProvider>
            </Provider>
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
    beforeEach(() => {
        jest.clearAllMocks()
        clearChatCommentsForLinkedEmails.mockResolvedValue(restoreUnreadState)
    })

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

    // AT-2263: "Archive all emails" is the widest label on the line and is what overlapped the
    // project title on a phone. On mobile only the archive icon is drawn.
    it('shows the icon without its label on mobile, keeping the wording as the accessible name', () => {
        const tree = renderButton({
            projectId: 'project-1',
            registrations: [
                { sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [email('conn-a', 'm1')] },
            ],
            smallScreenNavigation: true,
        })

        expect(labelsOf(tree)).toEqual([])
        expect(buttonOf(tree).props.accessibilityLabel).toBe('Archive emails')
        // Still one press away, and still the same press.
        expect(buttonOf(tree).props.disabled).toBe(false)
    })

    it('disappears again when the last preview holding an email unmounts', () => {
        const store = createStore(() => ({ smallScreenNavigation: false }))
        let tree
        act(() => {
            tree = renderer.create(
                <Provider store={store}>
                    <UnreadEmailArchiveProvider>
                        <PreviewRegistration
                            sourceKey="project-1:chat-1"
                            projectId="project-1"
                            linkedEmails={[email('conn-a', 'm1')]}
                        />
                        <ArchiveUnreadEmailsButton projectId="project-1" />
                    </UnreadEmailArchiveProvider>
                </Provider>
            )
        })
        expect(tree.toJSON()).not.toBeNull()

        act(() => {
            tree.update(
                <Provider store={store}>
                    <UnreadEmailArchiveProvider>
                        <ArchiveUnreadEmailsButton projectId="project-1" />
                    </UnreadEmailArchiveProvider>
                </Provider>
            )
        })

        expect(tree.toJSON()).toBeNull()
    })
})

describe('ArchiveUnreadEmailsButton scope', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        clearChatCommentsForLinkedEmails.mockResolvedValue(restoreUnreadState)
    })

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

        expect(archivePayloads()).toEqual(
            expect.arrayContaining([
                ['conn-a', { action: 'archive', messageIds: ['m1', 'm2'] }],
                ['conn-b', { action: 'archive', messageIds: ['m3'] }],
            ])
        )
        expect(archivePayloads()).toHaveLength(2)
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

    it('marks Alldone chats as read without changing the mailbox read state', async () => {
        performEmailLineAction.mockResolvedValue(undefined)
        const linked = email('conn-a', 'm1')
        const tree = renderButton({
            projectId: 'project-1',
            registrations: [{ sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [linked] }],
        })

        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(markMessagesAsRead).not.toHaveBeenCalled()
        expect(performEmailLineAction).toHaveBeenCalledWith('conn-a', { action: 'archive', messageIds: ['m1'] })
        expect(performEmailLineAction).not.toHaveBeenCalledWith('conn-a', { action: 'markRead', messageIds: ['m1'] })
        expect(clearChatCommentsForLinkedEmails).toHaveBeenCalledWith([linked])
        expect(restoreUnreadState).not.toHaveBeenCalled()
    })

    // The bulk version of the AT-2424 ordering: "Archive all emails" over a whole screen of
    // previews must empty the unread list on the press, not one mailbox round trip later.
    it('clears the unread state of every email in scope before calling the mailbox', async () => {
        const order = []
        clearChatCommentsForLinkedEmails.mockImplementation(async () => {
            order.push('clear-unread')
            return restoreUnreadState
        })
        performEmailLineAction.mockImplementation(async () => {
            order.push('mailbox')
        })
        const tree = renderButton({ projectId: undefined, registrations: twoProjects })

        await act(async () => {
            await buttonOf(tree).props.onPress()
        })

        expect(order[0]).toBe('clear-unread')
        expect(order.slice(1)).toEqual(['mailbox', 'mailbox'])
    })
})

describe('ArchiveUnreadEmailsButton states', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        clearChatCommentsForLinkedEmails.mockResolvedValue(restoreUnreadState)
    })

    const oneEmail = [{ sourceKey: 'project-1:chat-1', projectId: 'project-1', linkedEmails: [email('conn-a', 'm1')] }]

    // Was "shows a spinner ... while the archive is in flight". Since AT-2424 there is no spinner
    // to show: the press clears the unread state and flips the button, and the mailbox round trips
    // (4-8s in production) finish out of sight. A second press must still send nothing.
    it('reads as Archived and refuses a second press while the mailbox call is still running', async () => {
        let finishArchive
        let callCount = 0
        performEmailLineAction.mockImplementation(() => {
            callCount += 1
            if (callCount === 1) return new Promise(resolve => (finishArchive = resolve))
            return Promise.resolve()
        })
        const tree = renderButton({ projectId: 'project-1', registrations: oneEmail })

        let archivePromise
        await act(async () => {
            archivePromise = buttonOf(tree).props.onPress()
        })

        expect(labelsOf(tree)).toEqual(['Archived'])
        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0)
        expect(buttonOf(tree).props.disabled).toBe(true)
        expect(buttonOf(tree).props.accessibilityState).toEqual({ busy: false, disabled: true })

        act(() => {
            buttonOf(tree).props.onPress()
        })
        expect(performEmailLineAction).toHaveBeenCalledTimes(1)

        await act(async () => {
            finishArchive()
            await archivePromise
        })

        expect(labelsOf(tree)).toEqual(['Archived'])
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
        // The accessible name follows the state, because on mobile the swapped icon is the only
        // other thing that reports it (AT-2263).
        expect(buttonOf(tree).props.accessibilityLabel).toBe('Archived')
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

    // The failure mode the optimistic clear creates (AT-2424). In the real list, clearing the
    // unread state unmounts the previewed rows - and this button with them, since its scope goes
    // empty. The mailbox answer arrives seconds AFTER that, and the rollback brings the rows back;
    // if the failure had been local state it would have died with the unmount and the emails would
    // have silently reappeared as if nothing had been pressed.
    it('still reports a failure that arrives after the previewed rows have gone', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        let failArchive
        performEmailLineAction.mockReturnValue(new Promise((resolve, reject) => (failArchive = reject)))

        const store = createStore(() => ({ smallScreenNavigation: false }))
        const withRows = (
            <Provider store={store}>
                <UnreadEmailArchiveProvider>
                    <PreviewRegistration
                        sourceKey="project-1:chat-1"
                        projectId="project-1"
                        linkedEmails={[email('conn-a', 'm1')]}
                    />
                    <ArchiveUnreadEmailsButton projectId="project-1" />
                </UnreadEmailArchiveProvider>
            </Provider>
        )
        let tree
        act(() => {
            tree = renderer.create(withRows)
        })

        let archivePromise
        await act(async () => {
            archivePromise = buttonOf(tree).props.onPress()
        })

        // The unread state is cleared, so the row unmounts and takes the button's scope with it.
        act(() => {
            tree.update(
                <Provider store={store}>
                    <UnreadEmailArchiveProvider>
                        <ArchiveUnreadEmailsButton projectId="project-1" />
                    </UnreadEmailArchiveProvider>
                </Provider>
            )
        })
        expect(tree.toJSON()).toBeNull()

        // Gmail refuses, the rollback restores the unread comments, and the row comes back.
        await act(async () => {
            failArchive(new Error('offline'))
            await archivePromise
        })
        act(() => {
            tree.update(withRows)
        })

        expect(labelsOf(tree)).toEqual(['try again'])
        expect(buttonOf(tree).props.disabled).toBe(false)
        consoleError.mockRestore()
    })
})
