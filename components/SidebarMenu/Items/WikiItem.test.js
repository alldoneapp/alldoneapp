import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

const mockState = {
    loggedUser: { themeName: 'modern' },
    selectedSidebarTab: 'ROOT_TASKS',
    route: 'Root',
    smallScreenNavigation: false,
}
const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => mockDispatch,
}))
jest.mock('../../../redux/store', () => ({ __esModule: true, default: { getState: () => mockState } }))
jest.mock('../../../redux/actions', () => ({ hideWebSideBar: () => ({ type: 'Hide web side bar' }) }))
jest.mock('../../WikiView/wikiLinks', () => ({ openProjectWiki: jest.fn() }))
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

import { openProjectWiki } from '../../WikiView/wikiLinks'
import WikiItem from './WikiItem'

function mount() {
    let component
    act(() => {
        component = renderer.create(<WikiItem projectId="p1" projectColor="#39CCCC" />)
    })
    return component
}

const background = component =>
    StyleSheet.flatten(component.root.find(node => node.props.onMouseEnter && node.props.style).props.style)
        .backgroundColor

beforeEach(() => {
    jest.clearAllMocks()
    mockState.selectedSidebarTab = 'ROOT_TASKS'
    mockState.route = 'Root'
    mockState.smallScreenNavigation = false
})

describe('WikiItem', () => {
    it('opens the project wiki', () => {
        const component = mount()

        expect(component.root.findByType(Text).props.children).toBe('Wiki')
        act(() => component.root.findByType(TouchableOpacity).props.onPress())

        expect(openProjectWiki).toHaveBeenCalledWith('p1')
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('closes the sidebar behind it on a small screen', () => {
        mockState.smallScreenNavigation = true
        const component = mount()

        act(() => component.root.findByType(TouchableOpacity).props.onPress())

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'Hide web side bar' })
    })

    it('is marked while the wiki is open, but not on the wiki settings tab', () => {
        expect(background(mount())).toBe('idle')

        mockState.selectedSidebarTab = 'ROOT_WIKI'
        expect(background(mount())).toBe('active')

        mockState.route = 'ProjectDetailedView'
        expect(background(mount())).toBe('idle')
    })
})
