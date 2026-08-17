import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

/**
 * AT-2337: "All projects → Tasks" scope.
 *
 * The board used to render one project block per NORMAL **plus** per GUIDE project
 * (`getNormalAndGuideProjectsSortedBySortedAndWithProjectInFocusAtTheTop` filters guides
 * out of the normal list only to append the whole `guideProjectIds` array back at the
 * end). On a heavy dogfooding account that is 78 blocks, 64 of them guides that produce
 * nothing on screen — every one of them still mounts its watchers and re-renders.
 *
 * "All projects" now means ACTIVE projects, matching the convention shipped for the
 * Contacts view in AT-2335 (`contactsViewProjectScope.getProjectsForContactsView`), and
 * it is enforced through the very same helper — `ProjectHelper.getActiveProjects2`, which
 * excludes archived, template and guide projects.
 *
 * The one deliberate carve-out is the in-focus project: it is an explicit per-user pin and
 * keeps its place at the top of the board even when it falls outside the active scope, so
 * focusing a task can never make it disappear from the board it was focused on.
 */
export const getProjectIdsForAllProjectsTasks = ({
    projectIds,
    guideProjectIds,
    archivedProjectIds,
    templateProjectIds,
    loggedUserProjectsMap,
    loggedUserId,
    inFocusTaskProjectId,
}) => {
    const loadedProjects = projectIds.map(projectId => loggedUserProjectsMap[projectId]).filter(Boolean)

    // `getActiveProjects2` only reads these four id arrays off the user, so the board can
    // pass the slices it already selects instead of subscribing to the whole `loggedUser`.
    const activeProjects = ProjectHelper.getActiveProjects2(loadedProjects, {
        projectIds,
        archivedProjectIds,
        templateProjectIds,
        guideProjectIds,
    })

    const sortedActiveProjectIds = ProjectHelper.sortProjects(
        activeProjects.filter(project => project.id !== inFocusTaskProjectId),
        loggedUserId
    ).map(project => project.id)

    return inFocusTaskProjectId ? [inFocusTaskProjectId, ...sortedActiveProjectIds] : sortedActiveProjectIds
}
