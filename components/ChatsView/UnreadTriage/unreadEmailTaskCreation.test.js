/**
 * @jest-environment jsdom
 */

import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import UnreadMessagesList from './UnreadMessagesList'
import UnreadMessageRow from './UnreadMessageRow'
import { UnreadTriageProvider, sumTagCounts, useUnreadTriage } from './UnreadTriageContext'
import { UnreadEmailArchiveProvider } from '../unreadEmailArchiveContext'
import useGetUnreadChatMessages from '../../../hooks/Chats/useGetUnreadChatMessages'
import { performEmailLineAction } from '../../../utils/backends/EmailLine/emailLineBackend'
import {
    clearChatCommentsForLinkedEmails,
    markAlldoneChatsReadForLinkedEmails,
} from '../../../utils/backends/Chats/markChatCommentsAsRead'
import { runWithLastUnreadRedirect } from '../lastUnreadRedirect'
import { createUnreadEmailTask, resetUnreadEmailTaskCreation } from './unreadEmailTaskCreation'

jest.mock('../../../hooks/Chats/useGetUnreadChatMessages', () => jest.fn())
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../../utils/SharedHelper', () => ({ accessGranted: () => true }))
jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationData: () => ({ displayName: 'Jana Becker' }),
}))
jest.mock('../../ContactsView/Utils/useGetUserPresentationData', () => () => ({ displayName: 'Jana Becker' }))
jest.mock('../../../utils/backends/EmailLine/emailCommentReadSync', () => ({ syncEmailCommentsReadState: jest.fn() }))
jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    markChatCommentsAsRead: jest.fn(async () => {}),
    markAlldoneChatsReadForLinkedEmails: jest.fn(async () => {}),
    clearChatCommentsForLinkedEmails: jest.fn(),
}))
jest.mock('../lastUnreadRedirect', () => ({
    ...jest.requireActual('../lastUnreadRedirect'),
    runWithLastUnreadRedirect: jest.fn((projectIds, action) => action({ leftChats: () => false })),
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../Utils/ChatHelper', () => ({ onOpenChat: jest.fn() }))
jest.mock('../../TaskListView/EmailLine/emailLineHelper', () => ({ openUrlInNewTab: jest.fn() }))
jest.mock('../../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))
jest.mock('../../UIControls/SocialText/SocialText', () => {
    const { Text } = require('react-native')
    return ({ children }) => <Text>{children}</Text>
})
jest.mock('../../Icon', () => () => null)
jest.mock('../../../assets/svg/SVGGenericUser', () => () => null)

let mockState
const project = { id: 'project-1' }
const dailyEmails = { id: 'chat-emails', type: 'topics', title: 'Daily emails Privat 27.11.2026' }

const EMAIL = {
    id: 'c-flat',
    fromAssistant: true,
    creatorId: 'anna',
    created: 300,
    commentText: 'Email from Müller Merkle Immobilien (alarm@mm.de): 4-Zimmer-Neubauwohnung in Prenzlauer Berg.',
    gmailData: { messageId: 'm-flat', connectionId: 'conn-1', gmailEmail: 'me@example.com', emailKind: 'notification' },
}
const OTHER_EMAIL = {
    id: 'c-other',
    fromAssistant: true,
    creatorId: 'anna',
    created: 200,
    commentText: 'Email from Quora Digest (digest@quora.com): Daily digest.',
    gmailData: { messageId: 'm-other', connectionId: 'conn-1', emailKind: 'newsletter' },
}

// What the unread subscription currently delivers: the comments whose notification is still there.
let unreadMessages
let triage
function TriageProbe() {
    triage = useUnreadTriage()
    return null
}

const element = () => (
    <UnreadEmailArchiveProvider>
        <UnreadTriageProvider>
            <TriageProbe />
            <UnreadMessagesList project={project} chats={[dailyEmails]} />
        </UnreadTriageProvider>
    </UnreadEmailArchiveProvider>
)

const renderList = () => {
    let tree
    act(() => {
        tree = renderer.create(element())
    })
    return tree
}

// A snapshot of the unread comments arriving (the Firestore listener re-emitting).
const sync = tree => act(() => tree.update(element()))

const rowIds = tree => tree.root.findAllByType(UnreadMessageRow).map(node => node.props.row.message.id)
const findByLabel = (tree, label) =>
    tree.root.findAll(node => node.type === TouchableOpacity && node.props.accessibilityLabel === label)
const createButtonOf = (tree, commentId) =>
    tree.root
        .findAll(node => node.props.testID === `unread-row-create-task-${commentId}`)[0]
        .findAll(node => node.type === TouchableOpacity)[0]
const allCount = () => sumTagCounts(triage.projects).all || 0

// Settled after every test: an open request would stay shared (EmailTaskAction's in-flight map)
// with the next test's press for the same email.
const openRequests = []
const deferred = () => {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    openRequests.push(resolve)
    return { promise, resolve, reject }
}

describe('Create email task from the unread list (AT-3187)', () => {
    let restoreUnreadState

    beforeEach(() => {
        jest.clearAllMocks()
        // The failure paths log on purpose.
        jest.spyOn(console, 'error').mockImplementation(() => {})
        act(() => resetUnreadEmailTaskCreation())
        mockState = { loggedUser: { uid: 'user-1' }, smallScreenNavigation: false, projectChatNotifications: {} }
        unreadMessages = [EMAIL, OTHER_EMAIL]
        useGetUnreadChatMessages.mockImplementation(() => ({ messages: unreadMessages, loaded: true }))
        // Like the real clear: the notification goes from the local cache (the next snapshot no longer
        // has the comment), and the undo puts it back.
        restoreUnreadState = jest.fn(async () => {
            unreadMessages = [EMAIL, ...unreadMessages.filter(message => message.id !== EMAIL.id)]
        })
        clearChatCommentsForLinkedEmails.mockImplementation(async () => {
            // The real clear reads the comments from the cache first; the delete lands a tick later.
            await null
            unreadMessages = unreadMessages.filter(message => message.id !== EMAIL.id)
            return restoreUnreadState
        })
    })

    afterEach(async () => {
        await act(async () => {
            openRequests.splice(0).forEach(resolve => resolve(null))
        })
        console.error.mockRestore()
    })

    it('a slow success: the row goes on the press and does not flash back when the snapshots arrive', async () => {
        const request = deferred()
        performEmailLineAction.mockReturnValue(request.promise)
        const tree = renderList()
        expect(rowIds(tree)).toEqual(['c-flat', 'c-other'])
        expect(allCount()).toBe(2)

        // The press alone hides it, in the same render, before any write or snapshot.
        act(() => {
            createButtonOf(tree, 'c-flat').props.onPress()
        })
        expect(rowIds(tree)).toEqual(['c-other'])
        expect(allCount()).toBe(1)

        // A snapshot still carrying the comment (it arrived before the local delete landed) keeps it
        // hidden.
        sync(tree)
        expect(unreadMessages.map(message => message.id)).toContain('c-flat')
        expect(rowIds(tree)).toEqual(['c-other'])

        await act(async () => {})
        expect(unreadMessages.map(message => message.id)).not.toContain('c-flat')
        expect(clearChatCommentsForLinkedEmails).toHaveBeenCalledTimes(1)
        expect(performEmailLineAction).toHaveBeenCalledWith('conn-1', expect.objectContaining({ action: 'createTask' }))
        sync(tree)
        expect(rowIds(tree)).toEqual(['c-other'])

        // The server answers seconds later; the row stays gone, then and after the next snapshot.
        await act(async () => {
            request.resolve({ taskId: 't-flat', projectId: 'project-1' })
        })
        expect(rowIds(tree)).toEqual(['c-other'])
        sync(tree)
        expect(rowIds(tree)).toEqual(['c-other'])
        expect(allCount()).toBe(1)
        expect(restoreUnreadState).not.toHaveBeenCalled()
        expect(markAlldoneChatsReadForLinkedEmails).toHaveBeenCalledTimes(1)
        expect(findByLabel(tree, "Task couldn't be created. Try again")).toHaveLength(0)
    })

    it('a failure: the row comes back once, with the hint, and the hint creates the task on a retry', async () => {
        const request = deferred()
        performEmailLineAction.mockReturnValueOnce(request.promise)
        const tree = renderList()
        act(() => {
            createButtonOf(tree, 'c-flat').props.onPress()
        })
        await act(async () => {})
        sync(tree)
        expect(rowIds(tree)).toEqual(['c-other'])

        await act(async () => {
            request.reject(new Error('deadline-exceeded'))
        })
        sync(tree)

        expect(restoreUnreadState).toHaveBeenCalledTimes(1)
        expect(rowIds(tree)).toEqual(['c-flat', 'c-other'])
        expect(allCount()).toBe(2)
        expect(markAlldoneChatsReadForLinkedEmails).not.toHaveBeenCalled()
        expect(findByLabel(tree, "Task couldn't be created")).toHaveLength(1)
        const hint = findByLabel(tree, "Task couldn't be created. Try again")
        expect(hint).toHaveLength(1)

        // Retry from the hint: gone again at once, and this time for good.
        const retry = deferred()
        performEmailLineAction.mockReturnValueOnce(retry.promise)
        act(() => {
            hint[0].props.onPress({ stopPropagation: () => {} })
        })
        expect(rowIds(tree)).toEqual(['c-other'])
        await act(async () => {
            retry.resolve({ taskId: 't-flat', projectId: 'project-1' })
        })
        sync(tree)
        expect(rowIds(tree)).toEqual(['c-other'])
        expect(performEmailLineAction).toHaveBeenCalledTimes(2)
        expect(findByLabel(tree, "Task couldn't be created. Try again")).toHaveLength(0)
    })

    it('a double click, or pressing again while the request runs, creates one task', async () => {
        const request = deferred()
        performEmailLineAction.mockReturnValue(request.promise)
        const tree = renderList()
        const button = createButtonOf(tree, 'c-flat')
        const { linkedEmail } = tree.root.findAllByType(UnreadMessageRow)[0].props.row
        expect(linkedEmail.key).toBe('conn-1:m-flat')

        // Both clicks reach the button before React re-renders the list without the row.
        act(() => {
            button.props.onPress()
            button.props.onPress()
        })
        // And another trigger for the same email while the server still works.
        let third
        act(() => {
            third = createUnreadEmailTask('project-1', linkedEmail)
        })
        await act(async () => {
            request.resolve({ taskId: 't-flat', projectId: 'project-1' })
        })

        expect(await third).toEqual({ taskId: 't-flat', projectId: 'project-1' })
        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
        expect(clearChatCommentsForLinkedEmails).toHaveBeenCalledTimes(1)
        expect(markAlldoneChatsReadForLinkedEmails).toHaveBeenCalledTimes(1)
        expect(rowIds(tree)).toEqual(['c-other'])
    })

    it('a failure after the press already opened the tasks is reported by an alert', async () => {
        const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})
        runWithLastUnreadRedirect.mockImplementationOnce((projectIds, action) => action({ leftChats: () => true }))
        performEmailLineAction.mockRejectedValueOnce(new Error('unavailable'))
        const tree = renderList()

        await act(async () => {
            createButtonOf(tree, 'c-flat').props.onPress()
        })

        expect(runWithLastUnreadRedirect).toHaveBeenCalledWith(['project-1'], expect.any(Function))
        expect(alertSpy).toHaveBeenCalledWith("Task couldn't be created. Try again")
        expect(restoreUnreadState).toHaveBeenCalledTimes(1)
        alertSpy.mockRestore()
    })

    it('still creates the task when clearing the unread state fails, and marks it read afterwards', async () => {
        clearChatCommentsForLinkedEmails.mockRejectedValueOnce(new Error('cache'))
        performEmailLineAction.mockResolvedValueOnce({ taskId: 't-flat', projectId: 'project-1' })
        const tree = renderList()

        await act(async () => {
            createButtonOf(tree, 'c-flat').props.onPress()
        })

        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
        expect(markAlldoneChatsReadForLinkedEmails).toHaveBeenCalledTimes(1)
        expect(findByLabel(tree, "Task couldn't be created. Try again")).toHaveLength(0)
    })
})
