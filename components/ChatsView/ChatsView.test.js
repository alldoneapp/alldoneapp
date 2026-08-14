/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: jest.fn() }))
jest.mock('../../redux/actions', () => ({
    setChatsUnreadOnly: unreadOnly => ({ type: 'Set chats unread only', unreadOnly }),
    setNavigationRoute: jest.fn(),
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedAllProjects: index => index === -1,
    checkIfSelectedProject: index => index > -1,
}))
jest.mock('../../URLSystem/Chats/URLsChats', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_ALL_PROJECTS_CHATS_ALL: 'all-projects-all',
    URL_ALL_PROJECTS_CHATS_FOLLOWED: 'all-projects-followed',
    URL_PROJECT_USER_CHATS_ALL: 'project-all',
    URL_PROJECT_USER_CHATS_FOLLOWED: 'project-followed',
}))
jest.mock('../HashtagFilters/HashtagFiltersView', () => () => null)
jest.mock('../UIComponents/NothingToShowOnChats', () => () => null)
jest.mock('../TaskListView/Header/AllProjectsLine/AllProjectsLine', () => props => props.customRight || null)
jest.mock('../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    markAlldoneChatsReadForLinkedEmails: jest.fn(),
    markChatCommentsAsReadByMessageIds: jest.fn(),
}))
jest.mock('./ArchiveUnreadEmailsButton', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => React.createElement(View, { testID: 'archive-unread-emails', projectId: props.projectId })
})
jest.mock('./MarkAsRead', () => () => null)
jest.mock('./ChatsByProject', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props =>
        React.createElement(View, {
            testID: `project-chats-${props.project.id}`,
            unreadOnly: props.unreadOnly,
        })
})
jest.mock('./ChatFiltersLine', () => {
    const React = require('react')
    const { Text, TouchableOpacity, View } = require('react-native')
    return props =>
        React.createElement(
            View,
            null,
            React.createElement(
                TouchableOpacity,
                { testID: 'select-unread', onPress: () => props.setUnreadOnly(true) },
                React.createElement(Text, null, 'Unread')
            ),
            React.createElement(
                TouchableOpacity,
                { testID: 'select-all', onPress: () => props.setUnreadOnly(false) },
                React.createElement(Text, null, 'All')
            )
        )
})

import ChatsView from './ChatsView'
import { UnreadEmailArchiveProvider } from './unreadEmailArchiveContext'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'

const projects = [
    { id: 'project-1', index: 0, lastChatActionDate: 2 },
    { id: 'project-2', index: 1, lastChatActionDate: 1 },
]

const renderView = selectedProjectIndex => {
    const state = {
        selectedProjectIndex,
        loggedUserProjects: projects,
        loggedUser: { uid: 'user-1', archivedProjectIds: [], templateProjectIds: [] },
        chatsActiveTab: ALL_TAB,
        chatsUnreadOnly: false,
        smallScreenNavigation: false,
        isMiddleScreen: false,
    }
    useSelector.mockImplementation(selector => selector(state))

    let component
    act(() => {
        component = renderer.create(<ChatsView />)
    })
    return component
}

const switchToAll = component => {
    act(() => component.root.findByProps({ testID: 'select-all' }).props.onPress())
}

describe('ChatsView unread filter', () => {
    beforeEach(() => jest.clearAllMocks())

    it('switches Unread back to All in a project-specific chat view', () => {
        const component = renderView(0)

        act(() => component.root.findByProps({ testID: 'select-unread' }).props.onPress())
        switchToAll(component)

        expect(mockDispatch).toHaveBeenNthCalledWith(2, { type: 'Set chats unread only', unreadOnly: true })
        expect(mockDispatch).toHaveBeenNthCalledWith(3, { type: 'Set chats unread only', unreadOnly: false })
    })

    it('switches Unread back to All for every project in the All projects chat view', () => {
        const component = renderView(-1)

        act(() => component.root.findByProps({ testID: 'select-unread' }).props.onPress())
        switchToAll(component)

        expect(mockDispatch).toHaveBeenNthCalledWith(2, { type: 'Set chats unread only', unreadOnly: true })
        expect(mockDispatch).toHaveBeenNthCalledWith(3, { type: 'Set chats unread only', unreadOnly: false })
    })
})

// Which projects get a <ChatsByProject> section - and therefore a set of Firestore listeners -
// has now been investigated twice (AT-2162, AT-2200), both times partly wrong. Pin the contract.
const renderAllProjectsWith = ({ loggedUserProjects, archivedProjectIds = [], templateProjectIds = [] }) => {
    const state = {
        selectedProjectIndex: -1,
        loggedUserProjects,
        loggedUser: { uid: 'user-1', archivedProjectIds, templateProjectIds },
        chatsActiveTab: ALL_TAB,
        chatsUnreadOnly: false,
        smallScreenNavigation: false,
        isMiddleScreen: false,
    }
    useSelector.mockImplementation(selector => selector(state))

    let component
    act(() => {
        component = renderer.create(<ChatsView />)
    })
    return component
}

const renderedProjectIds = component =>
    component.root
        .findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('project-chats-'))
        .map(node => node.props.testID.replace('project-chats-', ''))

describe('ChatsView All Projects section selection', () => {
    beforeEach(() => jest.clearAllMocks())

    const normal = (id, lastChatActionDate) => ({ id, index: 0, lastChatActionDate })
    const guide = (id, lastChatActionDate) => ({ id, index: 0, lastChatActionDate, parentTemplateId: 'template-1' })

    it('mounts one section per project and excludes archived and template projects', () => {
        const component = renderAllProjectsWith({
            loggedUserProjects: [normal('active-1', 3), normal('archived-1', 2), normal('template-1', 1)],
            archivedProjectIds: ['archived-1'],
            templateProjectIds: ['template-1'],
        })

        expect(renderedProjectIds(component)).toEqual(['active-1'])
    })

    it('keeps guides, sorted after the normal projects', () => {
        // Guides are intentionally rendered, matching Tasks/Done, Goals, Notes and Skills. A guide
        // with a more recent lastChatActionDate must still sort below every normal project.
        const component = renderAllProjectsWith({
            loggedUserProjects: [
                guide('guide-old', 1),
                normal('normal-old', 2),
                guide('guide-new', 99),
                normal('normal-new', 50),
            ],
        })

        expect(renderedProjectIds(component)).toEqual(['normal-new', 'normal-old', 'guide-new', 'guide-old'])
    })

    it('renders nothing when the narrowed project list is empty', () => {
        const component = renderAllProjectsWith({ loggedUserProjects: [] })

        expect(renderedProjectIds(component)).toEqual([])
    })
})

describe('ChatsView bulk email archive', () => {
    beforeEach(() => jest.clearAllMocks())

    it('offers the all-projects archive on the All Projects line, scoped to every project', () => {
        const component = renderView(-1)

        const button = component.root.findByProps({ testID: 'archive-unread-emails' })
        // No projectId is what makes it span every project's previews rather than one project's.
        expect(button.props.projectId).toBeUndefined()
    })

    it('leaves the all-projects archive out of a single project view, which has its own', () => {
        const component = renderView(0)

        expect(component.root.findAllByProps({ testID: 'archive-unread-emails' })).toHaveLength(0)
    })

    it('wraps the whole screen in the shared preview registry the buttons read from', () => {
        const component = renderView(-1)

        expect(component.root.findAllByType(UnreadEmailArchiveProvider)).toHaveLength(1)
    })
})
