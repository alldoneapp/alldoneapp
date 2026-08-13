export const DEFAULT_PROJECT_OWNERSHIP_ERROR = 'The default project must be owned by the user'

export const isProjectOwnedByUser = (project, userId) => !!project && !!userId && project.creatorId === userId

export const getProjectsOwnedByUser = (projects, userId) =>
    (projects || []).filter(project => isProjectOwnedByUser(project, userId))

export const assertProjectOwnedByUser = (project, userId) => {
    if (!isProjectOwnedByUser(project, userId)) throw new Error(DEFAULT_PROJECT_OWNERSHIP_ERROR)
}

export const validateDefaultProjectSelection = async (userId, projectId, loadProject) => {
    if (!projectId) return null

    const project = await loadProject(projectId)
    assertProjectOwnedByUser(project, userId)
    return project
}
