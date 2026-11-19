/**
 * @jest-environment jsdom
 */

// AT-3104: which Chats-list actions arm the last-unread redirect (grey unread first, then the
// tasks). Every Chats-list press goes through `runWithLastUnreadRedirect`, the All Projects line's
// too: the view decides, not the touched project. The decision and the race handling are covered in
// lastUnreadRedirect.test.js.

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'
import { Provider } from 'react-redux'
import { createStore } from 'redux'

import MarkAsRead from './MarkAsRead'
import UnreadTriageMarkAsRead from './UnreadTriage/UnreadTriageMarkAsRead'
import { UnreadTriageProvider, useUnreadTriage } from './UnreadTriage/UnreadTriageContext'
import { UNREAD_TAG_ADS } from './UnreadTriage/unreadMessageTags'
import { UnreadEmailArchiveProvider, useUnreadEmailArchiveContext } from './unreadEmailArchiveContext'
import { runWithLastUnreadRedirect } from './lastUnreadRedirect'
import { markMessagesAsRead } from '../../utils/backends/Chats/chatsComments'
import { performEmailLineAction } from '../../utils/backends/EmailLine/emailLineBackend'
import { markChatCommentsAsRead } from '../../utils/backends/Chats/markChatCommentsAsRead'

jest.mock('./lastUnreadRedirect', () => {
    const actual = jest.requireActual('./lastUnreadRedirect')
    return { ...actual, runWithLastUnreadRedirect: jest.fn((projectIds, action) => action()) }
})
jest.mock('../../utils/backends/Chats/chatsComments', () => ({ markMessagesAsRead: jest.fn() }))
jest.mock('../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    clearChatCommentsForLinkedEmails: jest.fn(async () => async () => {}),
    markChatCommentsAsRead: jest.fn(async () => {}),
}))
jest.mock('../../utils/backends/EmailLine/emailCommentReadSync', () => ({ syncEmailCommentsReadState: jest.fn() }))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

const linkedEmail = (projectId, messageId) => ({
    key: `conn:${messageId}`,
    connectionProjectId: 'conn',
    messageId,
    commentId: `comment-${messageId}`,
    projectId,
    chatId: 'chat-1',
    commentRefs: [{ projectId, chatId: 'chat-1', commentId: `comment-${messageId}` }],
})

beforeEach(() => {
    runWithLastUnreadRedirect.mockClear()
    markMessagesAsRead.mockReset()
    performEmailLineAction.mockReset()
    performEmailLineAction.mockResolvedValue({ success: true })
})

describe('Mark as read buttons', () => {
    const renderButton = props =>
        renderer.create(
            <Provider store={createStore(() => ({ chatsActiveTab: 'all', smallScreenNavigation: false }))}>
                <MarkAsRead userId="user-1" {...props} />
            </Provider>
        )

    it('arms the redirect for a project line', async () => {
        const tree = renderButton({ projectId: 'project-1' })
        await act(async () => {
            await tree.root.findByType(TouchableOpacity).props.onPress()
        })
        expect(runWithLastUnreadRedirect).toHaveBeenCalledWith(['project-1'], expect.any(Function))
        expect(markMessagesAsRead).toHaveBeenCalledWith('project-1', 'user-1', 'all')
    })

    it('arms it for the All Projects line with every project it clears', async () => {
        const tree = renderButton({ projectIds: ['project-1', 'project-2'] })
        await act(async () => {
            await tree.root.findByType(TouchableOpacity).props.onPress()
        })
        expect(runWithLastUnreadRedirect).toHaveBeenCalledWith(['project-1', 'project-2'], expect.any(Function))
        expect(markMessagesAsRead).toHaveBeenCalledTimes(2)
    })
})

describe('the chat list archive', () => {
    let context
    const Probe = () => {
        context = useUnreadEmailArchiveContext()
        return null
    }

    const renderProvider = () =>
        renderer.create(
            <UnreadEmailArchiveProvider>
                <Probe />
            </UnreadEmailArchiveProvider>
        )

    it('arms the redirect with the projects of the archived emails and passes the result on', async () => {
        renderProvider()
        let result
        await act(async () => {
            result = await context.archive.archiveLinkedEmails([linkedEmail('project-1', 'm1')], {
                notifyOnError: false,
            })
        })
        expect(runWithLastUnreadRedirect).toHaveBeenCalledWith(['project-1'], expect.any(Function))
        expect(performEmailLineAction).toHaveBeenCalled()
        expect(result).toBe(true)
    })

    it('arms it with every project of a bulk archive (the All Projects line)', async () => {
        renderProvider()
        await act(async () => {
            await context.archive.archiveLinkedEmails(
                [linkedEmail('project-1', 'm2'), linkedEmail('project-2', 'm3')],
                { notifyOnError: false }
            )
        })
        expect(runWithLastUnreadRedirect).toHaveBeenCalledWith(['project-1', 'project-2'], expect.any(Function))
        expect(performEmailLineAction).toHaveBeenCalled()
    })
})

describe('the tag-filtered Mark as read', () => {
    let triage
    const Probe = () => {
        triage = useUnreadTriage()
        return null
    }

    it('arms the redirect for the All Projects line with the filtered messages of every project', async () => {
        const tree = renderer.create(
            <Provider store={createStore(() => ({ chatsActiveTab: 'all', smallScreenNavigation: false }))}>
                <UnreadTriageProvider>
                    <Probe />
                    <UnreadTriageMarkAsRead projectIds={['project-1', 'project-2']} userId="user-1" />
                </UnreadTriageProvider>
            </Provider>
        )
        act(() => {
            triage.setTagFilter(UNREAD_TAG_ADS)
            triage.registerProject('project-1', { ads: 1 }, [{ projectId: 'project-1', chatId: 'c', commentId: 'a1' }])
            triage.registerProject('project-2', { ads: 1 }, [{ projectId: 'project-2', chatId: 'c', commentId: 'a2' }])
        })
        await act(async () => {
            await tree.root.findByType(TouchableOpacity).props.onPress()
        })
        expect(runWithLastUnreadRedirect).toHaveBeenCalledWith(['project-1', 'project-2'], expect.any(Function))
        expect(markChatCommentsAsRead).toHaveBeenCalledWith([
            { projectId: 'project-1', chatId: 'c', commentId: 'a1' },
            { projectId: 'project-2', chatId: 'c', commentId: 'a2' },
        ])
    })
})
