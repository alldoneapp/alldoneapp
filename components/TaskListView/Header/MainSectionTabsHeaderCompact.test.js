import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => jest.fn(),
}))

jest.mock('../../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../../redux/actions', () => ({
    hideFloatPopup: jest.fn(),
    hideWebSideBar: jest.fn(),
    setSelectedSidebarTab: jest.fn(),
    storeCurrentUser: jest.fn(),
}))
jest.mock('../../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
// ProjectHelper drags the whole settings tree (and @hello-pangea/dnd) in; this suite is about layout.
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfProjectIsGuide: () => false },
    checkIfSelectedAllProjects: index => index === -1,
    checkIfSelectedProject: index => index >= 0,
}))
jest.mock('../../AllSections/allSectionHelper', () => ({ allGoals: {} }))

import MainSectionTabsHeader, { COMPACT_TABS_BREAKPOINT } from './MainSectionTabsHeader'
import { setLanguage } from '../../../i18n/TranslationService'

const buildState = () => ({
    selectedSidebarTab: 'Tasks',
    selectedProjectIndex: -1,
    loggedUserProjects: [],
    loggedUser: { realProjectIds: [], isAnonymous: false },
})

const setViewportWidth = width => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

const renderHeader = () => {
    let tree
    act(() => {
        tree = renderer.create(<MainSectionTabsHeader />)
    })
    return tree
}

const tabLabels = tree => tree.root.findAllByType(Text).map(text => text.props.children)

const flatten = style => StyleSheet.flatten(style)

/**
 * The five section labels do not fit on one line in German or Spanish on a phone: at 16px with
 * 10px padding a side they need ~372px, and a 390px viewport leaves the card ~336px. The mobile
 * layout was a horizontal ScrollView, so "Chats" was simply cut off with nothing indicating that
 * the row could scroll. Below COMPACT_TABS_BREAKPOINT the row is now fixed, tighter and smaller.
 */
describe('MainSectionTabsHeader compact mobile tabs', () => {
    const originalInnerWidth = window.innerWidth

    beforeEach(() => {
        mockState = buildState()
    })

    afterEach(() => {
        setViewportWidth(originalInnerWidth)
        setLanguage('en')
    })

    it('renders a fixed single row with the compact font and padding on a 390px phone', () => {
        setViewportWidth(390)
        setLanguage('de')
        const tree = renderHeader()

        expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
        expect(tabLabels(tree)).toEqual(['Aufgaben', 'Ziele', 'Notizen', 'Kontakte', 'Chats'])

        const buttons = tree.root.findAllByType(TouchableOpacity)
        expect(buttons).toHaveLength(5)
        buttons.forEach(button => {
            const buttonStyle = flatten(button.props.style)
            expect(buttonStyle.paddingHorizontal).toBe(6)
            expect(buttonStyle.flexShrink).toBe(1)
            const text = button.findByType(Text)
            expect(text.props.numberOfLines).toBe(1)
            expect(flatten(text.props.style).fontSize).toBe(14)
        })
    })

    it('keeps the centred scroller for the wider mobile layout', () => {
        setViewportWidth(COMPACT_TABS_BREAKPOINT)
        setLanguage('de')
        const tree = renderHeader()

        expect(tree.root.findAllByType(ScrollView)).toHaveLength(1)
        const button = tree.root.findAllByType(TouchableOpacity)[0]
        expect(flatten(button.props.style).paddingHorizontal).toBe(10)
        expect(flatten(button.findByType(Text).props.style).fontSize).toBe(16)
    })

    it('switches to the compact row when the viewport shrinks past the breakpoint', () => {
        setViewportWidth(600)
        const tree = renderHeader()
        expect(tree.root.findAllByType(ScrollView)).toHaveLength(1)

        act(() => {
            setViewportWidth(360)
            window.dispatchEvent(new Event('resize'))
        })

        expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
        expect(flatten(tree.root.findAllByType(Text)[0].props.style).fontSize).toBe(14)
    })
})
