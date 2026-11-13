import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import {
    hideFloatPopup,
    hideWebSideBar,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    switchProject,
} from '../../../redux/actions'
import store from '../../../redux/store'
import ProjectHelper, { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { dismissAllPopups } from '../../../utils/HelperFunctions'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import {
    consumeSectionExpansionRequest,
    getSectionExpansionKey,
    requestSectionExpansion,
} from './collapsibleTaskSection'

/**
 * AT-3027 - expand / collapse state of one Messages or Calendar section of one day.
 *
 * Plain component state, never persisted (a reload or project switch collapses again, like the
 * main list). The state remembers WHICH section it expanded (project, day, section), so a section
 * that is reused for another day never inherits an expansion.
 *
 * In the All projects view `expand` does what the main list's chevron does there: it opens the
 * project's task list. The pressed section is handed over with `requestSectionExpansion` and
 * arrives expanded.
 */
export default function useCollapsibleTaskSection({ projectId, projectIndex, dateKey, sectionKey }) {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
    const expansionKey = getSectionExpansionKey(projectId, dateKey, sectionKey)

    const [expandedKey, setExpandedKey] = useState(() =>
        inSelectedProject && consumeSectionExpansionRequest(expansionKey) ? expansionKey : null
    )

    // The same component can stay mounted across the switch into the project.
    useEffect(() => {
        if (inSelectedProject && consumeSectionExpansionRequest(expansionKey)) setExpandedKey(expansionKey)
    }, [inSelectedProject, expansionKey])

    const openProjectTasks = () => {
        const projectType = ProjectHelper.getTypeOfProject(store.getState().currentUser, projectId)
        dismissAllPopups(true, true, true)
        const actions = [
            hideFloatPopup(),
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            switchProject(projectIndex),
            setSelectedTypeOfProject(projectType),
        ]
        if (smallScreenNavigation) actions.push(hideWebSideBar())
        dispatch(actions)
    }

    const expand = () => {
        if (inSelectedProject) {
            setExpandedKey(expansionKey)
            return
        }
        if (projectIndex === undefined || projectIndex === null) return
        requestSectionExpansion(expansionKey)
        // Same deferral as MainSection: let the press finish before the board is swapped out.
        setTimeout(openProjectTasks)
    }

    const contract = () => setExpandedKey(null)

    return { expanded: expandedKey === expansionKey, expand, contract }
}
