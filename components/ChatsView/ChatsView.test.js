/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: jest.fn() }))
jest.mock('../../redux/actions', () => ({ setNavigationRoute: jest.fn() }))
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
jest.mock('../TaskListView/Header/AllProjectsLine/AllProjectsLine', () => () => null)
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
        expect(component.root.findByProps({ testID: 'project-chats-project-1' }).props.unreadOnly).toBe(true)
        switchToAll(component)

        expect(component.root.findByProps({ testID: 'project-chats-project-1' }).props.unreadOnly).toBe(false)
    })

    it('switches Unread back to All for every project in the All projects chat view', () => {
        const component = renderView(-1)

        act(() => component.root.findByProps({ testID: 'select-unread' }).props.onPress())
        expect(component.root.findByProps({ testID: 'project-chats-project-1' }).props.unreadOnly).toBe(true)
        expect(component.root.findByProps({ testID: 'project-chats-project-2' }).props.unreadOnly).toBe(true)
        switchToAll(component)

        expect(component.root.findByProps({ testID: 'project-chats-project-1' }).props.unreadOnly).toBe(false)
        expect(component.root.findByProps({ testID: 'project-chats-project-2' }).props.unreadOnly).toBe(false)
    })
})
