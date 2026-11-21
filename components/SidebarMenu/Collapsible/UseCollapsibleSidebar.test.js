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

// AT-3121: in Both with the "Anna on top" sidebar AnnaShell draws the sidebar left of the chat, so
// Alldone's pane has none floating over it and keeps no room for one.
describe('inside the pane of a shell that draws the sidebar', () => {
    const { AnnaShellSidebarContext } = require('../../Anna/AnnaShellSidebarContext')
    const runInShell = state => {
        useSelector.mockImplementation(selector => selector(state))
        let result
        const Probe = () => {
            result = useCollapsibleSidebar()
            return null
        }
        act(() => {
            renderer.create(
                <AnnaShellSidebarContext.Provider value={true}>
                    <Probe />
                </AnnaShellSidebarContext.Provider>
            )
        })
        return result
    }

    it('keeps no room for a collapsed sidebar', () => {
        expect(runInShell(stateWith({ sidebarExpanded: false })).overlay).toBe(false)
        // Outside that pane (the shell's own sidebar among others) it floats as before.
        expect(run(stateWith({ sidebarExpanded: false })).overlay).toBe(true)
    })
})
