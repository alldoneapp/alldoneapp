import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

/**
 * The projects a user can rate, in the order they appear in the sidebar.
 *
 * Extracted from the "new day" popup (EndDayStatisticsModal) so the Settings →
 * Happiness rating popup lists exactly the same projects in exactly the same
 * order (AT-2392). Template, archived and guide projects are excluded — you
 * cannot be happy or unhappy about a project you are not working in.
 */
export const getHappinessProjects = (projects, user) =>
    ProjectHelper.sortProjects(
        ProjectHelper.getActiveProjectsInList(
            projects,
            user.projectIds,
            user.archivedProjectIds,
            user.templateProjectIds,
            user.guideProjectIds
        ),
        user.uid
    )

export default getHappinessProjects
