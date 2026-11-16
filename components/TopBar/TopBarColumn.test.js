import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'
import AnnaTopStripContext, { AnnaStripSlotContext } from '../Anna/AnnaTopStripContext'
import { AnnaViewSwitchContext } from '../Anna/AnnaViewSwitch'

jest.mock('react-redux', () => ({ useSelector: jest.fn(), useDispatch: () => jest.fn() }))
jest.mock('./TopBar', () => 'TopBar')
jest.mock('./TopBarMobile/TopBarMobile', () => 'TopBarMobile')

import TopBarColumn from './TopBarColumn'

const flatStyle = node => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean))

const column = ({ underStrip = false, slot = null, viewSwitch = null }) => (
    <AnnaTopStripContext.Provider value={underStrip}>
        <AnnaStripSlotContext.Provider value={slot}>
            <AnnaViewSwitchContext.Provider value={viewSwitch}>
                <TopBarColumn>
                    <detail-content />
                </TopBarColumn>
            </AnnaViewSwitchContext.Provider>
        </AnnaStripSlotContext.Provider>
    </AnnaTopStripContext.Provider>
)

const render = (props, state = {}) => {
    useSelector.mockImplementation(selector =>
        selector({
            loggedUser: { sidebarExpanded: false },
            sidebarCompact: false,
            isMiddleScreen: false,
            smallScreenNavigation: false,
            ...state,
        })
    )
    let tree
    act(() => {
        tree = renderer.create(column(props))
    })
    return tree
}

// The detail views carry Alldone's top bar right of their sidebar, as RootView does.
describe('TopBarColumn', () => {
    it('shows the strip above the content on desktop, as wide as the content, and gives the slot back', () => {
        const release = jest.fn()
        const slot = { strip: <strip-element />, claim: jest.fn(() => release) }
        const tree = render({ underStrip: true, slot })
        expect(slot.claim).toHaveBeenCalledTimes(1)
        const holder = tree.root.findByType('strip-element').parent
        // TopBar's margins and the collapsed sidebar's 56px, like the detail view's content.
        expect(parseFloat(flatStyle(holder).marginLeft)).toBe(160)
        expect(parseFloat(flatStyle(holder).marginRight)).toBe(104)
        act(() => tree.unmount())
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('shows the phone bar in AnnaShell’s phone layout, with the menu where navigation is mobile', () => {
        const tree = render({ viewSwitch: { layout: 'alldone' } }, { smallScreenNavigation: true })
        const bar = tree.root.findByType('TopBarMobile')
        expect(bar.props.showMenu).toBe(true)
        expect(tree.root.findAllByType('TopBar')).toHaveLength(0)
    })

    it('adds no bar outside AnnaShell, as on a shared link', () => {
        const tree = render({})
        expect(tree.root.findAllByType('TopBar')).toHaveLength(0)
        expect(tree.root.findAllByType('TopBarMobile')).toHaveLength(0)
        expect(tree.root.findAllByType('detail-content')).toHaveLength(1)
    })

    it('keeps the content mounted when the strip leaves for assistant mode and comes back', () => {
        const slot = { strip: <strip-element />, claim: jest.fn(() => () => {}) }
        const tree = render({ underStrip: true, slot })
        const content = tree.root.findByType('detail-content')
        act(() => tree.update(column({ underStrip: true, slot: null })))
        expect(tree.root.findAllByType('strip-element')).toHaveLength(0)
        expect(tree.root.findByType('detail-content')).toBe(content)
        act(() => tree.update(column({ underStrip: true, slot })))
        expect(tree.root.findByType('detail-content')).toBe(content)
        expect(tree.root.findAllByType('strip-element')).toHaveLength(1)
    })
})
