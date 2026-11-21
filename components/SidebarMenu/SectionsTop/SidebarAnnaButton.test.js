import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

let mockState
const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }))
jest.mock('../../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../../redux/actions', () => ({ hideWebSideBar: () => ({ type: 'hide sidebar' }) }))
jest.mock('../../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
let mockExpanded = true
jest.mock('../Collapsible/UseCollapsibleSidebar', () => () => ({ expanded: mockExpanded }))

import SidebarAnnaButton from './SidebarAnnaButton'
import { AnnaSidebarModeContext } from '../../Anna/AnnaShellSidebarContext'
import { AnnaAppShownContext } from '../../Anna/AnnaTopStripContext'
import { setLanguage } from '../../../i18n/TranslationService'

const mount = (anna, appShown = true) => {
    let tree
    act(() => {
        tree = renderer.create(
            <AnnaSidebarModeContext.Provider value={anna}>
                <AnnaAppShownContext.Provider value={appShown}>
                    <SidebarAnnaButton />
                </AnnaAppShownContext.Provider>
            </AnnaSidebarModeContext.Provider>
        )
    })
    return tree
}
const button = tree => tree.root.findByType(TouchableOpacity)
const labels = tree => tree.root.findAllByType(Text).map(text => text.props.children)
const ringColor = tree =>
    StyleSheet.flatten(
        tree.root.findAll(node => node.type !== Text && StyleSheet.flatten(node.props?.style)?.borderRadius === 21)[0]
            .props.style
    ).borderColor

const anna = (overrides = {}) => ({
    name: 'Anna Alldone',
    photo: null,
    chatShown: false,
    onOpenChat: jest.fn(),
    onLeaveChat: jest.fn(),
    ...overrides,
})

beforeEach(() => {
    mockState = { smallScreenNavigation: false }
    mockExpanded = true
    mockDispatch.mockClear()
    setLanguage('de')
})
afterEach(() => setLanguage('en'))

// AT-3121: Anna as one big button at the very top of the "Anna on top" sidebar.
describe('the Anna button', () => {
    it('shows nothing outside the assistant shell', () => {
        expect(mount(null).toJSON()).toBeNull()
    })

    it('shows Anna with her question, and only her photo in the collapsed sidebar', () => {
        expect(labels(mount(anna()))).toEqual(['A', 'Anna Alldone', 'Wie kann ich helfen?'])
        mockExpanded = false
        expect(labels(mount(anna()))).toEqual(['A'])
    })

    it.each([
        ['closed', false, true, false, 'transparent'],
        ['alone on screen', true, false, true, 'transparent'],
        ['beside Alldone', true, true, false, '#007FFF'],
    ])('with the chat %s is marked: %s', (_, chatShown, appShown, marked, ring) => {
        const tree = mount(anna({ chatShown }), appShown)
        expect(button(tree).props.accessibilityState.selected).toBe(marked)
        expect(ringColor(tree)).toBe(ring)
    })

    it('opens the chat, closing the phone menu first', () => {
        mockState.smallScreenNavigation = true
        const value = anna()
        const tree = mount(value)
        act(() => button(tree).props.onPress())
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'hide sidebar' })
        expect(value.onOpenChat).toHaveBeenCalledTimes(1)
    })
})
