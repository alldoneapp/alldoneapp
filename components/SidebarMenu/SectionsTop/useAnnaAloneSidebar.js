import { useContext } from 'react'
import { useSelector } from 'react-redux'

import { isSectionsTopSidebarNavigation } from '../../../utils/SidebarNavigationModes'
import { AnnaSidebarModeContext } from '../../Anna/AnnaShellSidebarContext'
import { AnnaAppShownContext } from '../../Anna/AnnaTopStripContext'

/**
 * AT-3121, the "Anna on top" sidebar: whether Anna is alone on screen (`annaAlone`). Then the sidebar
 * marks only the Anna button, the projects stay folded, and a project or All projects picked there
 * leaves the chat for Alldone (`leaveChat`) instead of opening Alldone beside it.
 */
export default function useAnnaAloneSidebar() {
    const annaOnTop = useSelector(state => isSectionsTopSidebarNavigation(state.loggedUser.sidebarNavigationMode))
    const anna = useContext(AnnaSidebarModeContext)
    const appShown = useContext(AnnaAppShownContext)
    const annaAlone = annaOnTop && !!anna?.chatShown && !appShown
    return { annaAlone, leaveChat: () => anna?.onLeaveChat() }
}
