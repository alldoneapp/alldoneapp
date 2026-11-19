/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import UnreadMessagesList from './UnreadMessagesList'
import UnreadMessageRow from './UnreadMessageRow'
import { UnreadTriageProvider, sumTagCounts, useUnreadTriage } from './UnreadTriageContext'
import { UnreadEmailArchiveProvider, useUnreadLinkedEmailsScope } from '../unreadEmailArchiveContext'
import useGetUnreadChatMessages from '../../../hooks/Chats/useGetUnreadChatMessages'
import { markChatCommentsAsRead } from '../../../utils/backends/Chats/markChatCommentsAsRead'
import { onOpenChat } from '../Utils/ChatHelper'
import { UNREAD_SORT_SENDER, UNREAD_TAG_ADS, UNREAD_TAG_PEOPLE } from './unreadMessageTags'

jest.mock('../../../hooks/Chats/useGetUnreadChatMessages', () => jest.fn())
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../../utils/SharedHelper', () => ({ accessGranted: () => true }))
jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationData: userId => ({ displayName: userId === 'jana' ? 'Jana Becker' : 'Anna Alldone' }),
}))
jest.mock('../../ContactsView/Utils/useGetUserPresentationData', () => userId => ({
    displayName: userId === 'jana' ? 'Jana Becker' : 'Anna Alldone',
    photoURL: '',
}))
jest.mock('../../../utils/backends/EmailLine/emailCommentReadSync', () => ({ syncEmailCommentsReadState: jest.fn() }))
jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    markChatCommentsAsRead: jest.fn(async () => {}),
    clearChatCommentsForLinkedEmails: jest.fn(async () => async () => {}),
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../Utils/ChatHelper', () => ({ onOpenChat: jest.fn() }))
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
const dailyEmails = { id: 'chat-emails', type: 'topics', title: 'Daily emails Privat 18.11.2026' }
const taskChat = { id: 'chat-task', type: 'tasks', title: 'Compact task header' }

const MESSAGES = {
    'chat-emails': [
        {
            id: 'c-ad',
            fromAssistant: true,
            creatorId: 'anna',
            created: 300,
            commentText: 'Email from Zalando (deals@zalando.de): Black week, 50% off.',
            gmailData: { messageId: 'm-ad', connectionId: 'conn-1', labelKey: 'ads', emailKind: 'ads' },
        },
        {
            id: 'c-news',
            fromAssistant: true,
            creatorId: 'anna',
            created: 100,
            commentText: 'Email from Quora Digest (digest@quora.com): Daily digest.',
            gmailData: { messageId: 'm-news', connectionId: 'conn-1', emailKind: 'newsletter' },
        },
    ],
    'chat-task': [
        { id: 'c-jana', fromAssistant: false, creatorId: 'jana', created: 200, commentText: 'Header overlaps' },
    ],
}

let triage
function TriageProbe() {
    triage = useUnreadTriage()
    return null
}
let archiveScope
function ArchiveProbe() {
    archiveScope = useUnreadLinkedEmailsScope('project-1')
    return null
}

const renderList = () => {
    useGetUnreadChatMessages.mockImplementation((projectId, chatId) => ({ messages: MESSAGES[chatId], loaded: true }))
    let tree
    act(() => {
        tree = renderer.create(
            <UnreadEmailArchiveProvider>
                <UnreadTriageProvider>
                    <TriageProbe />
                    <ArchiveProbe />
                    <UnreadMessagesList project={project} chats={[dailyEmails, taskChat]} />
                </UnreadTriageProvider>
            </UnreadEmailArchiveProvider>
        )
    })
    return tree
}

const rowIds = tree => tree.root.findAllByType(UnreadMessageRow).map(node => node.props.row.message.id)

describe('UnreadMessagesList', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = {
            loggedUser: { uid: 'user-1' },
            smallScreenNavigation: false,
            projectChatNotifications: {
                'project-1': {
                    'chat-emails': {
                        totalUnfollowed: 2,
                        unfollowedNotifications: [{ commentId: 'c-ad' }, { commentId: 'c-news' }],
                    },
                    'chat-task': { totalFollowed: 1, followedNotifications: [{ commentId: 'c-jana' }] },
                },
            },
        }
    })

    it('lists the unread messages of every chat as one list, newest first', () => {
        const tree = renderList()
        expect(rowIds(tree)).toEqual(['c-ad', 'c-jana', 'c-news'])
    })

    it('publishes the tag counts of the project for the filter chips', () => {
        renderList()
        expect(sumTagCounts(triage.projects)).toEqual({ all: 3, ads: 1, newsletter: 1, people: 1 })
    })

    it('filters by tag, and the archive buttons act on the filtered emails only', () => {
        const tree = renderList()
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))

        expect(rowIds(tree)).toEqual(['c-ad'])
        expect(archiveScope.linkedEmails.map(email => email.messageId)).toEqual(['m-ad'])
        expect(triage.projects['project-1'].visibleCommentRefs).toEqual([
            { projectId: 'project-1', chatId: 'chat-emails', commentId: 'c-ad' },
        ])
    })

    it('says so when a tag has nothing left', () => {
        const tree = renderList()
        act(() => triage.setTagFilter(UNREAD_TAG_PEOPLE))
        expect(rowIds(tree)).toEqual(['c-jana'])
        expect(JSON.stringify(tree.toJSON())).not.toContain('Nothing unread with this tag')

        act(() => triage.setTagFilter('assistant'))
        expect(rowIds(tree)).toEqual([])
        expect(JSON.stringify(tree.toJSON())).toContain('Nothing unread with this tag')
    })

    it('sorts by sender', () => {
        const tree = renderList()
        act(() => triage.setSortMode(UNREAD_SORT_SENDER))
        expect(rowIds(tree)).toEqual(['c-jana', 'c-news', 'c-ad'])
    })

    it('shows the email sender and summary, not the "Email from" line', () => {
        const tree = renderList()
        const text = JSON.stringify(tree.toJSON())
        expect(text).toContain('Zalando')
        expect(text).toContain('Black week, 50% off.')
        expect(text).not.toContain('Email from Zalando')
    })
})

describe('UnreadMessageRow actions', () => {
    beforeEach(() => jest.clearAllMocks())

    const findAction = (rowInstance, label) =>
        rowInstance.findAll(node => node.props.accessibilityLabel === label && node.props.onPress)[0]

    it('marks only its own comment as read, without opening it', async () => {
        const tree = renderList()
        const row = tree.root.findAllByType(UnreadMessageRow).find(node => node.props.row.message.id === 'c-jana')
        await act(async () => {
            findAction(row, 'mark as read').props.onPress({ stopPropagation: jest.fn() })
        })
        expect(markChatCommentsAsRead).toHaveBeenCalledWith([
            { projectId: 'project-1', chatId: 'chat-task', commentId: 'c-jana' },
        ])
        expect(onOpenChat).not.toHaveBeenCalled()
    })

    it('offers archive on email rows only, and opens the chat of the row', () => {
        const tree = renderList()
        const rows = tree.root.findAllByType(UnreadMessageRow)
        const emailRow = rows.find(node => node.props.row.message.id === 'c-ad')
        const chatRow = rows.find(node => node.props.row.message.id === 'c-jana')

        expect(
            emailRow.findAll(node => node.props.accessibilityLabel === 'Archive email' && node.props.onPress)
        ).not.toHaveLength(0)
        expect(chatRow.findAll(node => node.props.accessibilityLabel === 'Archive email')).toHaveLength(0)

        act(() => findAction(chatRow, 'Open message').props.onPress({ stopPropagation: jest.fn() }))
        expect(onOpenChat).toHaveBeenCalledWith('project-1', taskChat)
    })
})
