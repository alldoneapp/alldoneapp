import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export const updateMyDayDoneDataLoadedState = (myDayDoneTasksByProject, user, loggedUserProjectsMap) => {
    const newMyDayDoneTasksByProject = { ...myDayDoneTasksByProject }

    const { projectIds, guideProjectIds, archivedProjectIds, templateProjectIds } = user

    const userProjectIds = ProjectHelper.getNormalAndGuideProjects(
        projectIds,
        guideProjectIds,
        archivedProjectIds,
        templateProjectIds,
        loggedUserProjectsMap
    )

    let allProjectsLoaded = true

    userProjectIds.forEach(projectId => {
        const projectData = newMyDayDoneTasksByProject[projectId]
        if (!projectData) allProjectsLoaded = false
    })

    if (allProjectsLoaded) newMyDayDoneTasksByProject.loaded = true

    return newMyDayDoneTasksByProject
}

export const generateMyDayDoneTasks = (myDayDoneTasksByProject, projects, user) => {
    const activeProjects = ProjectHelper.getActiveProjects2(projects, user)
    const guideProjects = ProjectHelper.getGuideProjects(projects, user)

    const sortedProjects = [
        ...ProjectHelper.sortProjects(activeProjects, user.uid),
        ...ProjectHelper.sortProjects(guideProjects, user.uid),
    ]

    const myDayDoneTasks = []
    sortedProjects.forEach(project => {
        const tasksInProject = myDayDoneTasksByProject[project.id]
        if (tasksInProject) myDayDoneTasks.push(...tasksInProject)
    })

    return myDayDoneTasks
}
