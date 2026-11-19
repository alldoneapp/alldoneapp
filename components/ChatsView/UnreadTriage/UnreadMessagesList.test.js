/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import UnreadMessagesList from './UnreadMessagesList'
import UnreadMessageRow from './UnreadMessageRow'
import UnreadTriageEmptyState from './UnreadTriageEmptyState'
import { UnreadTriageProvider, isTagFilterEmptyEverywhere, sumTagCounts, useUnreadTriage } from './UnreadTriageContext'
import { UnreadEmailArchiveProvider, useUnreadLinkedEmailsScope } from '../unreadEmailArchiveContext'
import useGetUnreadChatMessages from '../../../hooks/Chats/useGetUnreadChatMessages'
import { markChatCommentsAsRead } from '../../../utils/backends/Chats/markChatCommentsAsRead'
import { onOpenChat } from '../Utils/ChatHelper'
import { openUrlInNewTab } from '../../TaskListView/EmailLine/emailLineHelper'
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
jest.mock('../../../i18n/TranslationService', () => ({
    translate: (key, vars = {}) => (key === 'Actor via MCP client' ? `${vars.name} (via ${vars.client})` : key),
}))
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
            gmailData: {
                messageId: 'm-ad',
                connectionId: 'conn-1',
                gmailEmail: 'me@example.com',
                labelKey: 'ads',
                emailKind: 'ads',
            },
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

const renderList = (listProps = {}) => {
    useGetUnreadChatMessages.mockImplementation((projectId, chatId) => ({ messages: MESSAGES[chatId], loaded: true }))
    let tree
    act(() => {
        tree = renderer.create(
            <UnreadEmailArchiveProvider>
                <UnreadTriageProvider>
                    <TriageProbe />
                    <ArchiveProbe />
                    <UnreadMessagesList project={project} chats={[dailyEmails, taskChat]} {...listProps} />
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

// AT-3112: All Projects hides a project section whose messages the tag filter removes entirely,
// and shows one global empty state when no project has a match.
describe('projects the tag filter leaves empty', () => {
    const otherProject = { id: 'project-2' }
    const otherChat = { id: 'chat-other', type: 'topics', title: 'Business' }
    let messages
    let loaded

    const renderTwoProjects = (onEmpty1, onEmpty2) => {
        useGetUnreadChatMessages.mockImplementation((projectId, chatId) => ({
            messages: messages[chatId] || [],
            loaded: loaded[chatId] !== false,
        }))
        const element = () => (
            <UnreadEmailArchiveProvider>
                <UnreadTriageProvider>
                    <TriageProbe />
                    <UnreadTriageEmptyState projectIds={['project-1', 'project-2']} />
                    <UnreadMessagesList project={project} chats={[dailyEmails]} onFilteredEmptyChange={onEmpty1} />
                    <UnreadMessagesList project={otherProject} chats={[otherChat]} onFilteredEmptyChange={onEmpty2} />
                </UnreadTriageProvider>
            </UnreadEmailArchiveProvider>
        )
        let tree
        act(() => {
            tree = renderer.create(element())
        })
        return { tree, rerender: () => act(() => tree.update(element())) }
    }
    const lastCall = mock => mock.mock.calls[mock.mock.calls.length - 1][0]
    const showsGlobalEmpty = tree => tree.root.findAll(node => node.props.testID === 'unread-tag-empty').length > 0

    beforeEach(() => {
        jest.clearAllMocks()
        mockState = { loggedUser: { uid: 'user-1' }, smallScreenNavigation: false, projectChatNotifications: {} }
        messages = {
            'chat-emails': MESSAGES['chat-emails'],
            'chat-other': [{ id: 'c-biz', fromAssistant: false, creatorId: 'jana', created: 50, commentText: 'Hi' }],
        }
        loaded = {}
    })

    it('reports a project empty only while a tag filter leaves it no message', () => {
        const onEmpty1 = jest.fn()
        const onEmpty2 = jest.fn()
        const { tree } = renderTwoProjects(onEmpty1, onEmpty2)
        // Unread without a tag: nothing is hidden.
        expect(lastCall(onEmpty1)).toBe(false)
        expect(lastCall(onEmpty2)).toBe(false)

        // "Ads" (Werbung): project-1 has the ad, project-2 has none and is hidden.
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))
        expect(lastCall(onEmpty1)).toBe(false)
        expect(lastCall(onEmpty2)).toBe(true)
        expect(showsGlobalEmpty(tree)).toBe(false)

        // Switching the tag back brings it back.
        act(() => triage.setTagFilter(UNREAD_TAG_PEOPLE))
        expect(lastCall(onEmpty1)).toBe(true)
        expect(lastCall(onEmpty2)).toBe(false)
    })

    it('hides the last project and shows the global empty state once its match is read or archived', () => {
        const onEmpty1 = jest.fn()
        const { tree, rerender } = renderTwoProjects(onEmpty1, jest.fn())
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))
        expect(lastCall(onEmpty1)).toBe(false)
        expect(showsGlobalEmpty(tree)).toBe(false)

        // The ad is marked read (or its email archived): it leaves the unread messages.
        messages = { ...messages, 'chat-emails': messages['chat-emails'].filter(m => m.id !== 'c-ad') }
        rerender()
        expect(lastCall(onEmpty1)).toBe(true)
        expect(showsGlobalEmpty(tree)).toBe(true)
        expect(JSON.stringify(tree.toJSON())).toContain('Nothing unread with this tag')

        // A new ad arrives: the project and its rows come back, the global state goes.
        messages = { ...messages, 'chat-emails': MESSAGES['chat-emails'] }
        rerender()
        expect(lastCall(onEmpty1)).toBe(false)
        expect(showsGlobalEmpty(tree)).toBe(false)
    })

    it('waits for every project to load before showing the global empty state', () => {
        loaded = { 'chat-other': false }
        messages = { ...messages, 'chat-other': [] }
        const { tree, rerender } = renderTwoProjects(jest.fn(), jest.fn())
        act(() => triage.setTagFilter('assistant'))
        expect(triage.projects['project-2'].loaded).toBe(false)
        expect(showsGlobalEmpty(tree)).toBe(false)

        loaded = {}
        rerender()
        expect(triage.projects['project-2'].loaded).toBe(true)
        expect(showsGlobalEmpty(tree)).toBe(true)
    })

    it('resets the hidden state when the list unmounts (leaving Unread)', () => {
        const onEmpty2 = jest.fn()
        const { tree } = renderTwoProjects(jest.fn(), onEmpty2)
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))
        expect(lastCall(onEmpty2)).toBe(true)
        act(() => tree.unmount())
        expect(lastCall(onEmpty2)).toBe(false)
    })
})

describe('isTagFilterEmptyEverywhere', () => {
    const entry = (refs, loaded = true) => ({ counts: {}, visibleCommentRefs: refs, loaded })
    const ref = { projectId: 'p1', chatId: 'c', commentId: 'x' }

    it('is false without a tag filter or without projects', () => {
        expect(isTagFilterEmptyEverywhere({ tagFilter: 'all', projects: { p1: entry([]) } }, ['p1'])).toBe(false)
        expect(isTagFilterEmptyEverywhere({ tagFilter: 'ads', projects: {} }, [])).toBe(false)
        expect(isTagFilterEmptyEverywhere(null, ['p1'])).toBe(false)
    })

    it('is true only when every project registered, loaded and shows nothing', () => {
        const triageOf = projects => ({ tagFilter: 'ads', projects })
        expect(isTagFilterEmptyEverywhere(triageOf({ p1: entry([]), p2: entry([]) }), ['p1', 'p2'])).toBe(true)
        expect(isTagFilterEmptyEverywhere(triageOf({ p1: entry([]), p2: entry([ref]) }), ['p1', 'p2'])).toBe(false)
        expect(isTagFilterEmptyEverywhere(triageOf({ p1: entry([]) }), ['p1', 'p2'])).toBe(false)
        expect(isTagFilterEmptyEverywhere(triageOf({ p1: entry([]), p2: entry([], false) }), ['p1', 'p2'])).toBe(false)
    })
})

describe("a comment an MCP client wrote in the user's name", () => {
    it('is tagged Assistant and its sender reads "(via Claude)", as in the thread', () => {
        mockState = {
            loggedUser: { uid: 'user-1' },
            smallScreenNavigation: false,
            projectChatNotifications: {
                'project-1': { 'chat-task': { totalFollowed: 1, followedNotifications: [{ commentId: 'c-mcp' }] } },
            },
        }
        useGetUnreadChatMessages.mockImplementation(() => ({
            messages: [
                {
                    id: 'c-mcp',
                    fromAssistant: false,
                    creatorId: 'jana',
                    via: 'mcp',
                    viaClient: 'Claude',
                    created: 100,
                    commentText: 'Implemented locally, not committed yet.',
                },
            ],
            loaded: true,
        }))
        let tree
        act(() => {
            tree = renderer.create(
                <UnreadEmailArchiveProvider>
                    <UnreadTriageProvider>
                        <TriageProbe />
                        <UnreadMessagesList project={project} chats={[taskChat]} />
                    </UnreadTriageProvider>
                </UnreadEmailArchiveProvider>
            )
        })

        const row = tree.root.findByType(UnreadMessageRow)
        expect(row.props.row.tag).toBe('assistant')
        expect(JSON.stringify(tree.toJSON())).toContain('Jana Becker (via Claude)')
        expect(sumTagCounts(triage.projects)).toEqual({ all: 1, assistant: 1 })
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

        act(() => findAction(chatRow, 'Open chat').props.onPress({ stopPropagation: jest.fn() }))
        expect(onOpenChat).toHaveBeenCalledWith('project-1', taskChat)
    })

    it('opens an email row in Gmail in a new tab, and its chat icon opens the thread', () => {
        const tree = renderList()
        const emailRow = tree.root.findAllByType(UnreadMessageRow).find(node => node.props.row.message.id === 'c-ad')
        const rowTouchable = emailRow.find(node => node.props.testID === 'unread-row-c-ad' && node.props.onPress)

        act(() => rowTouchable.props.onPress())
        expect(openUrlInNewTab).toHaveBeenCalledTimes(1)
        expect(openUrlInNewTab.mock.calls[0][0]).toContain('m-ad')
        expect(onOpenChat).not.toHaveBeenCalled()

        act(() => findAction(emailRow, 'Open chat').props.onPress({ stopPropagation: jest.fn() }))
        expect(onOpenChat).toHaveBeenCalledWith('project-1', dailyEmails)
    })

    it('a chat row opens its chat when pressed', () => {
        const tree = renderList()
        const chatRow = tree.root.findAllByType(UnreadMessageRow).find(node => node.props.row.message.id === 'c-jana')
        act(() => chatRow.find(node => node.props.testID === 'unread-row-c-jana' && node.props.onPress).props.onPress())
        expect(onOpenChat).toHaveBeenCalledWith('project-1', taskChat)
        expect(openUrlInNewTab).not.toHaveBeenCalled()
    })
})
