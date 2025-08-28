import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export const updateMyDayWorkflowDataLoadedState = (myDayWorkflowTasksByProject, user, loggedUserProjectsMap) => {
    const newMyDayWorkflowTasksByProject = { ...myDayWorkflowTasksByProject }

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
        const projectData = newMyDayWorkflowTasksByProject[projectId]
        if (!projectData) allProjectsLoaded = false
    })

    if (allProjectsLoaded) newMyDayWorkflowTasksByProject.loaded = true

    return newMyDayWorkflowTasksByProject
}

export const generateMyDayWorkflowTasks = (myDayWorkflowTasksByProject, projects, user) => {
    const activeProjects = ProjectHelper.getActiveProjects2(projects, user)
    const guideProjects = ProjectHelper.getGuideProjects(projects, user)

    const sortedProjects = [
        ...ProjectHelper.sortProjects(activeProjects, user.uid),
        ...ProjectHelper.sortProjects(guideProjects, user.uid),
    ]

    const myDayWorkflowTasks = []
    sortedProjects.forEach(project => {
        const tasksInProject = myDayWorkflowTasksByProject[project.id]
        if (tasksInProject) myDayWorkflowTasks.push(...tasksInProject)
    })

    return myDayWorkflowTasks
}
