import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'
import AnnaTopStripContext from '../Anna/AnnaTopStripContext'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
    useDispatch: () => jest.fn(),
}))
jest.mock('./TopBar', () => 'TopBar')
jest.mock('./TopBarMobile/TopBarMobile', () => 'TopBarMobile')

import TopBarContainer from './TopBarContainer'

const render = (state, inStrip) => {
    useSelector.mockImplementation(selector =>
        selector({ loggedUser: { sidebarExpanded: true }, isMiddleScreen: false, ...state })
    )
    let tree
    act(() => {
        tree = renderer.create(
            <AnnaTopStripContext.Provider value={inStrip}>
                <TopBarContainer />
            </AnnaTopStripContext.Provider>
        )
    })
    return tree
}

// On desktop AnnaShell's strip above Alldone (and the chat) carries gold, search, chats, updates and,
// where Alldone uses mobile navigation, the sidebar menu, so Alldone must not repeat its own bar.
describe('TopBarContainer and the assistant strip', () => {
    it('renders its bar outside assistant mode', () => {
        const tree = render({ smallScreenNavigation: false }, false)
        // TopBar or its compact form, depending on the test window's width.
        const bars = [...tree.root.findAllByType('TopBar'), ...tree.root.findAllByType('TopBarMobile')]
        expect(bars).toHaveLength(1)
    })

    it('leaves the bar to the strip on desktop', () => {
        const tree = render({ smallScreenNavigation: false }, true)
        expect(tree.toJSON()).toBeNull()
    })

    it('leaves the bar to the strip also where Alldone uses mobile navigation', () => {
        const tree = render({ smallScreenNavigation: true }, true)
        expect(tree.toJSON()).toBeNull()
    })
})
