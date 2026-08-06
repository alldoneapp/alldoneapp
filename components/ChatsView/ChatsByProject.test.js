/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import ChatsByProject from './ChatsByProject'
import { watchChatsAmount, unwatchChatsAmount } from '../../utils/backends/Chats/chatNumbers'
import useGetChats from '../../hooks/Chats/useGetChats'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'

const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: jest.fn() }))

jest.mock('../../utils/backends/Chats/chatNumbers', () => ({
    watchChatsAmount: jest.fn(),
    unwatchChatsAmount: jest.fn(),
}))
jest.mock('../../hooks/Chats/useGetChats', () => jest.fn(() => ({})))
jest.mock('../../hooks/Chats/useGetStickyChats', () => jest.fn(() => []))
jest.mock('../../hooks/Chats/useGetUnreadChats', () => jest.fn(() => ({ chats: {}, stickyChats: [], total: 0 })))

jest.mock('./ChatsByDate', () => () => null)
jest.mock('./StickyChats', () => () => null)
jest.mock('./MarkAsRead', () => () => null)
jest.mock('../TaskListView/Header/ProjectHeader', () => () => null)
jest.mock('../UIControls/ShowMoreButton', () => () => null)
jest.mock('../UIComponents/FloatModals/MorePopupsOfMainViews/Chats/ChatsMoreButton', () => () => null)
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({ getDateFormat: () => 'DD.MM.YYYY' }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getTypeOfProject: () => 'normal' },
    checkIfSelectedAllProjects: index => index === -1,
}))
jest.mock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../redux/actions', () => ({
    hideFloatPopup: jest.fn(),
    hideWebSideBar: jest.fn(),
    setSelectedSidebarTab: jest.fn(),
    setSelectedTypeOfProject: jest.fn(),
    switchProject: jest.fn(),
}))

const PROJECT = { id: 'project-1', index: 0 }

const buildState = (numberChatsAllTeams, selectedProjectIndex = -1) => ({
    loggedUser: { uid: 'user-1', numberChatsAllTeams },
    smallScreenNavigation: false,
    chatsActiveTab: ALL_TAB,
    selectedProjectIndex,
    projectChatNotifications: {},
})

const renderView = (state, props = {}) => {
    useSelector.mockImplementation(selector => selector(state))
    let tree
    act(() => {
        tree = renderer.create(
            <ChatsByProject
                project={PROJECT}
                isInAllProjects
                setChatXProject={jest.fn()}
                unreadOnly={false}
                {...props}
            />
        )
    })
    return tree
}

describe('ChatsByProject chats-amount watcher', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useGetChats.mockReturnValue({})
    })

    it('caps the amount query at the number of chats it renders in All Projects', () => {
        renderView(buildState(3))

        expect(watchChatsAmount).toHaveBeenCalledTimes(1)
        const [projectId, , , activeTab, visibleAmount] = watchChatsAmount.mock.calls[0]
        expect(projectId).toBe('project-1')
        expect(activeTab).toBe(ALL_TAB)
        // Without this argument the watcher reads the project's entire chats collection.
        expect(visibleAmount).toBe(3)
    })

    it('falls back to the default page size when the user has no configured amount', () => {
        renderView(buildState(undefined, 0), { isInAllProjects: false })

        expect(watchChatsAmount.mock.calls[0][4]).toBe(10)
    })

    it('re-subscribes with a larger cap when the list is expanded', () => {
        // A project with more chats than fit on one page, so the "show more" button is rendered.
        useGetChats.mockReturnValue({ 20260806: [{ id: 'chat-1', lastEditionDate: 1786000000000 }] })
        const state = buildState(undefined, 0)
        useSelector.mockImplementation(selector => selector(state))

        let tree
        act(() => {
            tree = renderer.create(<ChatsByProject project={PROJECT} setChatXProject={jest.fn()} unreadOnly={false} />)
        })

        expect(watchChatsAmount.mock.calls[0][4]).toBe(10)

        // The watcher reports the capped amount (toRender + 1), which is what makes the button show.
        act(() => watchChatsAmount.mock.calls[0][2](11))

        const showMore = tree.root
            .findAllByProps({ expanded: false })
            .find(node => typeof node.props.expand === 'function')
        act(() => showMore.props.expand())

        expect(unwatchChatsAmount).toHaveBeenCalled()
        expect(watchChatsAmount).toHaveBeenCalledTimes(2)
        expect(watchChatsAmount.mock.calls[1][4]).toBe(20)
    })

    it('stops watching on unmount', () => {
        const tree = renderView(buildState(3))
        act(() => tree.unmount())
        expect(unwatchChatsAmount).toHaveBeenCalledTimes(1)
    })
})
