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
// The section picker's popover measures the DOM; here it only has to show what it would open.
jest.mock('../../UIComponents/ModalShell/AppPopover', () => ({ __esModule: true, default: ({ children }) => children }))

import MainSectionTabsHeader, { COMPACT_TABS_BREAKPOINT, TIGHT_TABS_BREAKPOINT } from './MainSectionTabsHeader'
import { setLanguage } from '../../../i18n/TranslationService'
import HeaderPickerArrow from './HeaderPickerArrow'
import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { SECTION_ICONS } from '../../../utils/sectionIcons'

const buildState = () => ({
    selectedSidebarTab: 'Tasks',
    selectedProjectIndex: -1,
    loggedUserProjects: [],
    loggedUser: { realProjectIds: [], isAnonymous: false, sidebarNavigationMode: 'simple' },
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
 * the row could scroll. Below COMPACT_TABS_BREAKPOINT the row is now fixed, tighter and smaller,
 * and below TIGHT_TABS_BREAKPOINT ("Artefakte" took the Chats slot) smaller again.
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

    // Whether the labels actually fit is measured in real Chromium by browser-tests/section-tabs;
    // jsdom has no text metrics, so this pins the styles that measurement was taken with.
    it.each([
        [320, 13, 0],
        [340, 13, 0],
        [TIGHT_TABS_BREAKPOINT - 1, 13, 0],
        [TIGHT_TABS_BREAKPOINT, 15, 1],
        [390, 15, 1],
        [419, 15, 1],
    ])('renders a fixed single row at %ipx with %ipx labels and %ipx tab padding', (width, fontSize, padding) => {
        setViewportWidth(width)
        setLanguage('de')
        const tree = renderHeader()

        expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
        expect(tabLabels(tree)).toEqual(['Aufgaben', 'Ziele', 'Notizen', 'Kontakte', 'Artefakte'])

        const buttons = tree.root.findAllByType(TouchableOpacity)
        expect(buttons).toHaveLength(5)
        buttons.forEach(button => {
            const buttonStyle = flatten(button.props.style)
            expect(buttonStyle.paddingHorizontal).toBe(padding)
            expect(buttonStyle.flexShrink).toBe(1)
            const text = button.findByType(Text)
            expect(text.props.numberOfLines).toBe(1)
            expect(flatten(text.props.style).fontSize).toBe(fontSize)
        })
    })

    it.each([COMPACT_TABS_BREAKPOINT, 817])('keeps the 16px centred scroller at %ipx', width => {
        setViewportWidth(width)
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
            setViewportWidth(390)
            window.dispatchEvent(new Event('resize'))
        })

        expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
        expect(flatten(tree.root.findAllByType(Text)[0].props.style).fontSize).toBe(15)

        act(() => {
            setViewportWidth(320)
            window.dispatchEvent(new Event('resize'))
        })

        expect(flatten(tree.root.findAllByType(Text)[0].props.style).fontSize).toBe(13)

        act(() => {
            setViewportWidth(COMPACT_TABS_BREAKPOINT)
            window.dispatchEvent(new Event('resize'))
        })

        expect(tree.root.findAllByType(ScrollView)).toHaveLength(1)
        expect(flatten(tree.root.findAllByType(Text)[0].props.style).fontSize).toBe(16)
    })

    it('adapts to the workspace width when it is narrower than the browser window', () => {
        setViewportWidth(1440)
        mockState.screenDimensions = { width: 680 }
        const tree = renderHeader()
        expect(tree.root.findAllByType(ScrollView)).toHaveLength(1)

        mockState.screenDimensions = { width: 390 }
        act(() => tree.update(<MainSectionTabsHeader />))
        expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
        expect(flatten(tree.root.findAllByType(Text)[0].props.style).fontSize).toBe(15)
        act(() => tree.unmount())
    })
})

/**
 * AT-3121: with the "Anna on top" sidebar (stored as 'sectionsTop') the sections are in the sidebar, so
 * the card above the lists keeps only the section's name and its toggle (Open / Workflow / Done and
 * so on). The name, with a small arrow, opens the section picker the Updates header uses.
 */
describe('MainSectionTabsHeader with Anna on top of the sidebar', () => {
    const AppPopover = require('../../UIComponents/ModalShell/AppPopover').default
    const originalInnerWidth = window.innerWidth
    const title = tree => tree.root.findByProps({ testID: 'section-title' })
    const titleLabel = tree => title(tree).findByProps({ testID: 'section-title-label' })

    beforeEach(() => {
        mockState = {
            ...buildState(),
            selectedSidebarTab: 'ROOT_NOTES',
            loggedUser: { realProjectIds: [], isAnonymous: false, sidebarNavigationMode: 'sectionsTop' },
        }
    })

    afterEach(() => {
        setViewportWidth(originalInnerWidth)
        setLanguage('en')
    })

    it.each([1440, 600, 390])('shows the section name with an arrow and no tabs at %ipx', width => {
        setViewportWidth(width)
        setLanguage('de')
        const tree = renderHeader()

        expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
        const buttons = tree.root.findAllByType(TouchableOpacity)
        expect(buttons).toHaveLength(1)
        expect(buttons[0].props.testID).toBe('section-title')
        expect(titleLabel(tree).props.children).toBe('Notizen')
        expect(title(tree).props.accessibilityLabel).toBe('Notizen – Wähle die Sektion aus')
    })

    // AT-3123: on a phone the name and its arrow sat on the left of the card; they are centred as one
    // unit for every section the picker offers, and the picker opens centred under them.
    it.each(['ROOT_TASKS', 'ROOT_GOALS', 'ROOT_NOTES', 'ROOT_CONTACTS', 'ROOT_CHATS', 'ROOT_ARTIFACTS', 'ROOT_WIKI'])(
        'centres the %s name with its arrow in the mobile card',
        sectionTab => {
            mockState = { ...mockState, selectedSidebarTab: sectionTab }
            setViewportWidth(390)
            const tree = renderHeader()

            expect(flatten(title(tree).props.style)).toMatchObject({
                alignSelf: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
            })
            expect(tree.root.findByType(AppPopover).props.align).toBe('center')
        }
    )

    it.each([600, 390, 340])('centres the name above the section toggle at %ipx', width => {
        setViewportWidth(width)
        let tree
        act(() => {
            tree = renderer.create(
                <MainSectionTabsHeader showSectionToggle={true} renderSectionToggle={() => <Text>toggle</Text>} />
            )
        })

        expect(flatten(title(tree).props.style).alignSelf).toBe('center')
        // The arrow lives inside the centred title, so both move together.
        expect(title(tree).findAllByType(HeaderPickerArrow)).toHaveLength(1)
        expect(tabLabels(tree)).toEqual(expect.arrayContaining(['Notes', 'toggle']))
    })

    // AT-3155: the name is led by the section's icon, the glyph the sidebar and the picker show for it.
    const SECTIONS = [
        ['ROOT_TASKS', 'check-square'],
        ['ROOT_GOALS', 'target'],
        ['ROOT_NOTES', 'file-text'],
        ['ROOT_CONTACTS', 'users'],
        ['ROOT_CHATS', 'comments-thread'],
        ['ROOT_ARTIFACTS', 'package'],
        ['ROOT_WIKI', 'book-open'],
    ]

    it.each(SECTIONS.flatMap(([section, icon]) => [390, 1440].map(width => [section, icon, width])))(
        'leads the %s name with its %s icon at %ipx',
        (sectionTab, icon, width) => {
            mockState = { ...mockState, selectedSidebarTab: sectionTab }
            setViewportWidth(width)
            const tree = renderHeader()

            const [first, second, third] = title(tree).props.children
            expect(first.type).toBe(Icon)
            expect(first.props).toMatchObject({ name: icon, size: 20, color: colors.Primary100 })
            expect(second.props.testID).toBe('section-title-label')
            expect(third.type).toBe(HeaderPickerArrow)
            // The icon keeps its size when a long name shrinks, and leaves a gap before the name.
            expect(flatten(first.props.style)).toMatchObject({ marginRight: 8, flexShrink: 0 })
            expect(SECTION_ICONS[sectionTab]).toBe(icon)
        }
    )

    it('falls back to the Tasks icon where the name falls back to Tasks', () => {
        mockState = { ...mockState, selectedSidebarTab: 'ROOT_UPDATES' }
        const tree = renderHeader()

        expect(title(tree).props.children[0].props.name).toBe('check-square')
        expect(titleLabel(tree).props.children).toBe('Tasks')
    })

    it('shows no icon in the section tabs of the other sidebar modes', () => {
        mockState = { ...mockState, loggedUser: { ...mockState.loggedUser, sidebarNavigationMode: 'simple' } }
        setViewportWidth(1440)
        const tree = renderHeader()

        expect(tree.root.findAllByType(Icon)).toHaveLength(0)
    })

    it('keeps the desktop name on the left of the card', () => {
        setViewportWidth(1440)
        const tree = renderHeader()

        expect(flatten(title(tree).props.style).alignSelf).toBe('flex-start')
        expect(tree.root.findByType(AppPopover).props.align).toBe('start')
    })

    it('keeps the section toggle next to the name', () => {
        setViewportWidth(1440)
        let tree
        act(() => {
            tree = renderer.create(
                <MainSectionTabsHeader showSectionToggle={true} renderSectionToggle={() => <Text>toggle</Text>} />
            )
        })

        expect(tabLabels(tree)).toEqual(expect.arrayContaining(['Notes', 'toggle']))
    })

    it('opens the section picker from the name', () => {
        setViewportWidth(1440)
        const tree = renderHeader()
        const picker = () => tree.root.findByType(AppPopover)
        expect(picker().props.isOpen).toBe(false)

        act(() => title(tree).props.onPress())
        expect(picker().props.isOpen).toBe(true)
        // The same sections as a project, All projects included (AT-3121: it has a wiki too).
        expect(picker().props.content.props).toMatchObject({ withArtifacts: true, withWiki: true })
    })
})
