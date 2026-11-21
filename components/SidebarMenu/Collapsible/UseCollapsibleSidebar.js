import { useContext } from 'react'
import { useSelector } from 'react-redux'

import { AnnaShellSidebarContext } from '../../Anna/AnnaShellSidebarContext'

// The sidebar as shown: the user's preference, except below the desktop assistant strip where the
// expanded sidebar does not fit (`sidebarCompact`, responsiveLayout.js). There it stays collapsed
// and floats open on hover, and the stored preference is untouched.
export const selectSidebarExpanded = state => !!state.loggedUser.sidebarExpanded && !state.sidebarCompact

export default function useCollapsibleSidebar() {
    const sidebarExpanded = useSelector(selectSidebarExpanded)
    const sidebarHovered = useSelector(state => state.sidebarHovered)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const addProjectIsOpen = useSelector(state => state.addProjectIsOpen)
    const addContactIsOpen = useSelector(state => state.addContactIsOpen)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    // AT-3121: where AnnaShell draws the sidebar left of the chat, Alldone's pane has none of its own
    // floating over it, so it keeps no room for one.
    const shellDrawsSidebar = useContext(AnnaShellSidebarContext)

    const expanded = isAnonymous || mobile || addProjectIsOpen || addContactIsOpen || sidebarExpanded || sidebarHovered
    const overlay = !isAnonymous && !mobile && !sidebarExpanded && !shellDrawsSidebar

    return { expanded, overlay }
}
