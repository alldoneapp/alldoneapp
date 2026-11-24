import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'

let mockState
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../Collapsible/UseCollapsibleSidebar', () => () => ({ expanded: true }))
// The sidebar themes import the comment input themes; their module chain reaches the backend.
jest.mock('../../Feeds/CommentsTextInput/textInputHelper', () => ({}))

import SectionDivider from './SectionDivider'
import { COLORS_THEME_DEFAULT, COLORS_THEME_MODERN } from '../../../Themes/Themes'
import Colors from '../../../Themes/Colors'
import ThemedColors from '../../../Themes/ThemedColors'

const render = themeName => {
    mockState = { loggedUser: { themeName } }
    let tree
    act(() => {
        tree = renderer.create(<SectionDivider projectColor="#39CCCC" />)
    })
    const container = tree.root.findByProps({ testID: 'sidebar-section-divider' })
    const line = container.props.children
    return { container: StyleSheet.flatten(container.props.style), line: StyleSheet.flatten(line.props.style) }
}

// AT-3139: a 1px line, on the section rows' background, in an existing token of each sidebar theme.
describe('SectionDivider', () => {
    it('is a 1px line in the theme token, on the section background', () => {
        const neutral = render(COLORS_THEME_MODERN)
        expect(neutral.container.height).toBe(1)
        expect(neutral.container.backgroundColor).toBeTruthy()
        // One step lighter than the first version (Grey400), still a mode-aware token, not hex.
        expect(neutral.line.backgroundColor).toBe(ThemedColors.Grey350)
        expect(neutral.line.backgroundColor).toMatch(/^var\(--ad-/)

        const blue = render(COLORS_THEME_DEFAULT)
        expect(blue.container.height).toBe(1)
        expect(blue.container.backgroundColor).toBe(Colors.Secondary250)
        expect(blue.line.backgroundColor).toBe(Colors.Secondary100)
    })
})
