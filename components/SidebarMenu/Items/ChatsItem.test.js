import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

const mockState = {
    loggedUser: { themeName: 'modern' },
    selectedSidebarTab: 'ROOT_TASKS',
    route: 'ROOT_TASKS',
    smallScreenNavigation: false,
}
const mockDispatch = jest.fn()
const mockNavigate = jest.fn()
const mockGetSidebarChatsActions = jest.fn(() => [{ type: 'open chats' }])

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => mockDispatch,
}))
jest.mock('../../../redux/store', () => ({ __esModule: true, default: { getState: () => mockState } }))
jest.mock('../../../utils/NavigationService', () => ({
    __esModule: true,
    default: { navigate: (...args) => mockNavigate(...args) },
}))
jest.mock('../openSidebarChats', () => ({
    getSidebarChatsActions: (...args) => mockGetSidebarChatsActions(...args),
}))
jest.mock('../../Icon', () => () => null)
jest.mock('../Collapsible/UseCollapsibleSidebar', () => () => ({ expanded: true }))
jest.mock('../Themes', () => ({
    getUserItemTheme: () => ({
        container: () => ({ backgroundColor: 'idle' }),
        containerActive: () => ({ backgroundColor: 'active' }),
        name: { color: 'grey' },
        nameActive: { color: 'grey', fontWeight: 'bold' },
    }),
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))

import ChatsItem from './ChatsItem'

function mount() {
    let component
    act(() => {
        component = renderer.create(<ChatsItem projectId="p1" projectColor="#39CCCC" />)
    })
    return component
}

const background = component =>
    StyleSheet.flatten(component.root.find(node => node.props.onMouseEnter && node.props.style).props.style)
        .backgroundColor

const press = component => act(() => component.root.findByType(TouchableOpacity).props.onPress())

beforeEach(() => {
    jest.clearAllMocks()
    mockState.selectedSidebarTab = 'ROOT_TASKS'
    mockState.route = 'ROOT_TASKS'
})

describe('ChatsItem (AT-3020)', () => {
    it('opens the project chats the way the advanced sidebar does', () => {
        const component = mount()

        expect(component.root.findByType(Text).props.children).toBe('Chats')
        press(component)

        expect(mockGetSidebarChatsActions).toHaveBeenCalledWith(mockState, 'p1')
        expect(mockDispatch).toHaveBeenCalledWith([{ type: 'open chats' }])
        expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('goes back to the root views from a detailed view first', () => {
        mockState.route = 'TaskDetailedView'
        press(mount())

        expect(mockNavigate).toHaveBeenCalledWith('Root')
        expect(mockDispatch).toHaveBeenCalledWith([{ type: 'open chats' }])
    })

    it('is marked while the chats list or a chat is open, but not on the project settings', () => {
        expect(background(mount())).toBe('idle')

        mockState.selectedSidebarTab = 'ROOT_CHATS'
        expect(background(mount())).toBe('active')

        mockState.route = 'ProjectDetailedView'
        expect(background(mount())).toBe('idle')

        mockState.selectedSidebarTab = 'ROOT_TASKS'
        mockState.route = 'ChatDetailedView'
        expect(background(mount())).toBe('active')
    })
})
