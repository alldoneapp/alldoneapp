import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

export const getProjectsForContactsView = (inAllProjects, loggedUserProjects, loggedUser) =>
    inAllProjects ? ProjectHelper.getActiveProjects2(loggedUserProjects, loggedUser) : loggedUserProjects
