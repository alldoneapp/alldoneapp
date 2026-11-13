// AT-3036 — the Alldone workspace on the right follows the project the assistant chat on the
// left continues in. Only a choice made in the chat itself moves the workspace (the composer's
// project chip, the assistant picker at the top left, a jump to another project's chat). Entering
// assistant mode from an assistant line (AT-3034) does not: that line already sits in the
// workspace's project, and moving the workspace from there would start a loop between both sides.
//
// Free of ProjectHelper and the store on purpose: both pull in the firestore client. The plan is
// pure over the redux state shape; `syncAnnaWorkspaceProject` applies it.

import { ROOT_ROUTES, DV_TAB_ROOT_GOALS, DV_TAB_ROOT_TASKS, DV_TAB_ROOT_WIKI } from '../../utils/TabNavigationConstants'
import { allGoals } from '../AllSections/allSectionHelper'
import { ANNA_AUTOMATIC_PROJECT } from './annaProjectSelection'

// ProjectHelper's ALL_PROJECTS_INDEX.
export const ANNA_ALL_PROJECTS_INDEX = -1
// The wiki is a per-project view; All projects has none.
const PROJECT_ONLY_TABS = [DV_TAB_ROOT_WIKI]
const PROJECT_TYPE_ACTIVE = 'active'

/**
 * What the workspace has to do so that it shows the chat's project, or null when it already does.
 * "Automatic" (AT-3024) continues the default project's chat but lets the assistant route each
 * task to any project, so All projects and the default project both match it, and a workspace in
 * another project moves to All projects (the AT-3034 line mapping read backwards).
 */
export function planAnnaWorkspaceProjectSync(state = {}, choiceId) {
    const {
        loggedUser = {},
        loggedUserProjects = [],
        loggedUserProjectsMap = {},
        selectedProjectIndex,
        route,
        selectedSidebarTab,
    } = state
    const automatic = !choiceId || choiceId === ANNA_AUTOMATIC_PROJECT
    const currentProjectId =
        Number.isInteger(selectedProjectIndex) && selectedProjectIndex > ANNA_ALL_PROJECTS_INDEX
            ? loggedUserProjects?.[selectedProjectIndex]?.id || null
            : null
    if (
        automatic
            ? !currentProjectId || currentProjectId === loggedUser.defaultProjectId
            : currentProjectId === choiceId
    )
        return null
    const projectIndex = automatic ? ANNA_ALL_PROJECTS_INDEX : loggedUserProjectsMap?.[choiceId]?.index
    if (!Number.isInteger(projectIndex) || (!automatic && projectIndex < 0)) return null
    // Keep the kind of view (tasks, notes, goals, …); an object's detail view belongs to the old
    // project, so it goes back to the root list of the same kind.
    const onRoot = ROOT_ROUTES.includes(route)
    let tab = ROOT_ROUTES.includes(selectedSidebarTab) ? selectedSidebarTab : DV_TAB_ROOT_TASKS
    if (automatic && PROJECT_ONLY_TABS.includes(tab)) tab = DV_TAB_ROOT_TASKS
    return {
        projectIndex,
        projectId: automatic ? null : choiceId,
        tab,
        navigateToRoot: !onRoot,
        // Like the header's project picker (ProjectLine): goals show every member's goals,
        // everything else the signed-in user's own board, never the old project's member.
        currentUser: tab === DV_TAB_ROOT_GOALS ? allGoals : loggedUser,
    }
}

export function syncAnnaWorkspaceProject(choiceId, { getState, dispatch, navigate }) {
    const plan = planAnnaWorkspaceProjectSync(getState(), choiceId)
    if (!plan) return null
    // Lazily, like openChatsList: the actions module is large and the plan above is the testable part.
    const {
        setSelectedSidebarTab,
        setSelectedTypeOfProject,
        storeCurrentUser,
        storeLoggedUser,
        switchProject,
    } = require('../../redux/actions')
    const { loggedUser } = getState()
    if (plan.navigateToRoot) navigate('Root')
    dispatch([
        ...(plan.projectId && loggedUser?.showAllProjectsByTime
            ? [storeLoggedUser({ ...loggedUser, showAllProjectsByTime: false })]
            : []),
        switchProject(plan.projectIndex),
        storeCurrentUser(plan.currentUser),
        setSelectedTypeOfProject(PROJECT_TYPE_ACTIVE),
        setSelectedSidebarTab(plan.tab),
    ])
    return plan
}
