import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'
import useCollapsibleSidebar, { selectSidebarExpanded } from './UseCollapsibleSidebar'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))

const stateWith = ({ sidebarExpanded, sidebarCompact = false, sidebarHovered = false }) => ({
    loggedUser: { sidebarExpanded, isAnonymous: false },
    sidebarCompact,
    sidebarHovered,
    smallScreenNavigation: false,
    addProjectIsOpen: false,
    addContactIsOpen: false,
})

const run = state => {
    useSelector.mockImplementation(selector => selector(state))
    let result
    const Probe = () => {
        result = useCollapsibleSidebar()
        return null
    }
    act(() => {
        renderer.create(<Probe />)
    })
    return result
}

// Below the desktop assistant strip, where the expanded sidebar does not fit (`sidebarCompact`),
// the sidebar shows collapsed and floats open on hover, whatever the stored preference says.
describe('the sidebar below the assistant strip', () => {
    it('follows the preference where the expanded sidebar fits', () => {
        expect(selectSidebarExpanded(stateWith({ sidebarExpanded: true }))).toBe(true)
        expect(selectSidebarExpanded(stateWith({ sidebarExpanded: false }))).toBe(false)
        expect(run(stateWith({ sidebarExpanded: true }))).toEqual({ expanded: true, overlay: false })
    })

    it('stays collapsed where it does not fit, also with the preference expanded', () => {
        const state = stateWith({ sidebarExpanded: true, sidebarCompact: true })
        expect(selectSidebarExpanded(state)).toBe(false)
        expect(run(state)).toEqual({ expanded: false, overlay: true })
        expect(state.loggedUser.sidebarExpanded).toBe(true)
    })

    it('floats open on hover where it does not fit', () => {
        expect(run(stateWith({ sidebarExpanded: true, sidebarCompact: true, sidebarHovered: true }))).toEqual({
            expanded: true,
            overlay: true,
        })
    })
})
