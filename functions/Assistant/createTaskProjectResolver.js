const normalizeProjectNameForLookup = value => (typeof value === 'string' ? value.trim().toLowerCase() : '')

const projectNamesMatch = (projectNameA, projectNameB) => {
    const a = normalizeProjectNameForLookup(projectNameA)
    const b = normalizeProjectNameForLookup(projectNameB)
    return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
}

async function resolveCreateTaskTargetProject(
    database,
    { creatorId, contextProjectId, assistantId, globalProjectId, requestedProjectId, requestedProjectName }
) {
    const normalizedRequestedProjectId = typeof requestedProjectId === 'string' ? requestedProjectId.trim() : ''
    const normalizedRequestedProjectName = typeof requestedProjectName === 'string' ? requestedProjectName.trim() : ''

    if (normalizedRequestedProjectId) {
        return {
            targetProjectId: normalizedRequestedProjectId,
            targetProjectName: null,
            source: 'toolArgs.projectId',
        }
    }

    let userData = null
    if (creatorId) {
        try {
            const userDoc = await database.collection('users').doc(creatorId).get()
            if (userDoc.exists) userData = userDoc.data() || {}
        } catch (error) {
            console.error('Error fetching user data for create_task project resolution:', error)
        }
    }

    if (normalizedRequestedProjectName) {
        const { ProjectService } = require('../shared/ProjectService')
        const projectService = new ProjectService({ database })
        await projectService.initialize()

        const projects = await projectService.getUserProjects(creatorId, {
            includeArchived: false,
            includeCommunity: false,
        })

        const normalizedLookupName = normalizeProjectNameForLookup(normalizedRequestedProjectName)
        const exactMatches = projects.filter(
            project => normalizeProjectNameForLookup(project.name) === normalizedLookupName
        )
        const partialMatches =
            exactMatches.length === 0
                ? projects.filter(project => projectNamesMatch(project.name, normalizedRequestedProjectName))
                : []
        const matchingProject = exactMatches[0] || partialMatches[0] || null

        if (matchingProject) {
            return {
                targetProjectId: matchingProject.id,
                targetProjectName: matchingProject.name,
                source: exactMatches[0] ? 'toolArgs.projectName_exact' : 'toolArgs.projectName_partial',
            }
        }
    }

    const candidateProjectIds = []
    const appendProjectId = value => {
        if (typeof value === 'string' && value.trim() && !candidateProjectIds.includes(value.trim())) {
            candidateProjectIds.push(value.trim())
        }
    }

    if (normalizedRequestedProjectName) {
        appendProjectId(userData?.defaultProjectId)
    }

    appendProjectId(contextProjectId)
    appendProjectId(userData?.defaultProjectId)
    if (Array.isArray(userData?.projectIds)) {
        userData.projectIds.forEach(pid => appendProjectId(pid))
    }
    appendProjectId(globalProjectId)

    if (candidateProjectIds.length > 0) {
        try {
            const assistantRefs = candidateProjectIds.map(pid => database.doc(`assistants/${pid}/items/${assistantId}`))
            const assistantDocs = await database.getAll(...assistantRefs)
            const assistantIndex = assistantDocs.findIndex(doc => doc.exists)

            if (assistantIndex >= 0) {
                const targetProjectId = candidateProjectIds[assistantIndex]
                let targetProjectName = null

                if (targetProjectId !== globalProjectId) {
                    try {
                        const assistantProjectDoc = await database.collection('projects').doc(targetProjectId).get()
                        if (assistantProjectDoc.exists) {
                            targetProjectName = assistantProjectDoc.data().name || null
                        }
                    } catch (error) {
                        console.error('Error fetching assistant fallback project for create_task:', error)
                    }
                }

                return {
                    targetProjectId,
                    targetProjectName,
                    source:
                        normalizedRequestedProjectName && userData?.defaultProjectId === targetProjectId
                            ? 'defaultProjectFallback'
                            : 'assistantProject',
                }
            }
        } catch (error) {
            console.error('Error resolving assistant project for create_task:', error)
        }
    }

    throw new Error('No project specified and no assistant project found. Please specify a projectId or projectName.')
}

module.exports = {
    resolveCreateTaskTargetProject,
}
