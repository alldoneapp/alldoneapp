import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
    useDispatch: () => jest.fn(),
}))
jest.mock('./TopBarStatisticArea', () => 'TopBarStatisticArea')
jest.mock('./NotificationArea', () => 'NotificationArea')
jest.mock('./HomeButton', () => 'HomeButton')
jest.mock('./ConnectionStatusChip', () => 'ConnectionStatusChip')

import TopBar from './TopBar'

const render = responsiveState => {
    const state = {
        loggedUser: { themeName: 'default', isAnonymous: false, sidebarExpanded: true },
        ...responsiveState,
    }
    useSelector.mockImplementation(selector => selector(state))
    return renderer.create(<TopBar />).root
}

/**
 * AT-2426. The header row is a non-wrapping flex line in which nothing gives way —
 * react-native-web's base `View` sets `flexShrink: 0`, `NotificationArea` is a hard
 * `width: 160`, and `XpBar`'s manual offset is computed from the container's own width
 * and so never budgets for the chip. A labelled chip costs ~165px, which the row does
 * not have at tablet sizes: it pushes `rightArea` (search / chat / bell) past the right
 * edge. The chip therefore leaves the header entirely there, exactly as on mobile, and
 * `MainViewsContainer` stacks it underneath.
 */
describe('TopBar connection chip placement', () => {
    it('keeps the chip in the header on wide desktop, where the row has room', () => {
        const tree = render({ smallScreenNavigation: false, smallScreen: false })

        expect(tree.findAllByType('ConnectionStatusChip')).toHaveLength(1)
    })

    it.each([
        ['tablet portrait', { smallScreenNavigation: false, smallScreen: true, isMiddleScreen: true }],
        // iPad Air / Pro 11 landscape (1180 / 1194px): `smallScreen` without being
        // `isMiddleScreen`. Measured to overflow the header in German.
        ['tablet landscape', { smallScreenNavigation: false, smallScreen: true, isMiddleScreen: false }],
    ])('drops the chip from the header at %s sizes', (_mode, state) => {
        const tree = render(state)

        expect(tree.findAllByType('ConnectionStatusChip')).toHaveLength(0)
    })

    it('still renders the rest of the header row when the chip stands down', () => {
        const tree = render({ smallScreenNavigation: false, smallScreen: true })

        expect(tree.findAllByType('NotificationArea')).toHaveLength(1)
        expect(tree.findAllByType('TopBarStatisticArea')).toHaveLength(1)
    })
})
