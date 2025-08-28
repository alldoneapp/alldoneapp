import { useSelector } from 'react-redux'

export default function useCollapsibleSidebar() {
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const sidebarHovered = useSelector(state => state.sidebarHovered)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const addProjectIsOpen = useSelector(state => state.addProjectIsOpen)
    const addContactIsOpen = useSelector(state => state.addContactIsOpen)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)

    const expanded = isAnonymous || mobile || addProjectIsOpen || addContactIsOpen || sidebarExpanded || sidebarHovered
    const overlay = !isAnonymous && !mobile && !sidebarExpanded

    return { expanded, overlay }
}
