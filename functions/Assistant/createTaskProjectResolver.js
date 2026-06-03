const normalizeProjectNameForLookup = value => (typeof value === 'string' ? value.trim().toLowerCase() : '')

const projectNamesMatch = (projectNameA, projectNameB) => {
    const a = normalizeProjectNameForLookup(projectNameA)
    const b = normalizeProjectNameForLookup(projectNameB)
    return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
}

const buildProjectSelectionReason = ({ source, targetProjectName = '', requestedProjectName = '' }) => {
    const projectName = targetProjectName || 'this project'

    switch (source) {
        case 'toolArgs.projectId':
            return `The task creation request explicitly targeted ${projectName}.`
        case 'toolArgs.projectName_exact':
            return `The task creation request named "${requestedProjectName}", which exactly matched ${projectName}.`
        case 'toolArgs.projectName_partial':
            return `The task creation request named "${requestedProjectName}", which closely matched ${projectName}.`
        case 'defaultProjectFallback':
            return `I could not find a project matching "${requestedProjectName}", so I used your default project ${projectName}.`
        case 'contextProject':
            return `The task creation request did not specify a project, so I used the current chat project ${projectName}.`
        case 'whatsappContextProject':
            return `The WhatsApp task request did not specify a project, so I used the current WhatsApp project context ${projectName}.`
        case 'gmailLabelMatchedProject':
            return `The Gmail label classifier matched ${projectName}, so I created the follow-up task there.`
        case 'defaultProject':
            return `The task creation request did not specify a project, so I used your default project ${projectName}.`
        case 'assistantProject':
            return `The task creation request did not specify a project, so I used the assistant's available project ${projectName}.`
        case 'globalProject':
            return `The task creation request did not specify a project, so I used the global assistant project.`
        default:
            return `I chose ${projectName} based on the task creation context.`
    }
}

const buildSelectionResult = ({ targetProjectId, targetProjectName = null, source, requestedProjectName = '' }) => {
    return {
        targetProjectId,
        targetProjectName,
        source,
        reasoning: buildProjectSelectionReason({
            source,
            targetProjectName,
            requestedProjectName,
        }),
    }
}

async function fetchProjectName(database, projectId, globalProjectId) {
    if (!projectId || projectId === globalProjectId) return null

    try {
        const projectDoc = await database.collection('projects').doc(projectId).get()
        return projectDoc.exists ? projectDoc.data()?.name || null : null
    } catch (error) {
        console.error('Error fetching project name for create_task project resolution:', error)
        return null
    }
}

async function resolveCreateTaskTargetProject(
    database,
    { creatorId, contextProjectId, assistantId, globalProjectId, requestedProjectId, requestedProjectName, sourceHint }
) {
    const normalizedRequestedProjectId = typeof requestedProjectId === 'string' ? requestedProjectId.trim() : ''
    const normalizedRequestedProjectName = typeof requestedProjectName === 'string' ? requestedProjectName.trim() : ''
    const normalizedSourceHint = typeof sourceHint === 'string' ? sourceHint.trim() : ''

    if (normalizedRequestedProjectId) {
        const targetProjectName = await fetchProjectName(database, normalizedRequestedProjectId, globalProjectId)
        return buildSelectionResult({
            targetProjectId: normalizedRequestedProjectId,
            targetProjectName,
            source: normalizedSourceHint || 'toolArgs.projectId',
        })
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
            return buildSelectionResult({
                targetProjectId: matchingProject.id,
                targetProjectName: matchingProject.name,
                source: exactMatches[0] ? 'toolArgs.projectName_exact' : 'toolArgs.projectName_partial',
                requestedProjectName: normalizedRequestedProjectName,
            })
        }
    }

    const candidateProjects = []
    const appendProjectId = (value, source) => {
        const projectId = typeof value === 'string' ? value.trim() : ''
        if (projectId && !candidateProjects.some(project => project.id === projectId)) {
            candidateProjects.push({ id: projectId, source })
        }
    }

    if (normalizedRequestedProjectName) {
        appendProjectId(userData?.defaultProjectId, 'defaultProjectFallback')
    }

    appendProjectId(contextProjectId, 'contextProject')
    appendProjectId(userData?.defaultProjectId, 'defaultProject')
    if (Array.isArray(userData?.projectIds)) {
        userData.projectIds.forEach(pid => appendProjectId(pid, 'assistantProject'))
    }
    appendProjectId(globalProjectId, 'globalProject')

    if (candidateProjects.length > 0) {
        try {
            const assistantRefs = candidateProjects.map(project =>
                database.doc(`assistants/${project.id}/items/${assistantId}`)
            )
            const assistantDocs = await database.getAll(...assistantRefs)
            const assistantIndex = assistantDocs.findIndex(doc => doc.exists)

            if (assistantIndex >= 0) {
                const selectedCandidate = candidateProjects[assistantIndex]
                const targetProjectId = selectedCandidate.id
                const targetProjectName = await fetchProjectName(database, targetProjectId, globalProjectId)

                return buildSelectionResult({
                    targetProjectId,
                    targetProjectName,
                    source:
                        normalizedRequestedProjectName && userData?.defaultProjectId === targetProjectId
                            ? 'defaultProjectFallback'
                            : selectedCandidate.source,
                    requestedProjectName: normalizedRequestedProjectName,
                })
            }
        } catch (error) {
            console.error('Error resolving assistant project for create_task:', error)
        }
    }

    throw new Error('No project specified and no assistant project found. Please specify a projectId or projectName.')
}

module.exports = {
    buildProjectSelectionReason,
    resolveCreateTaskTargetProject,
}
