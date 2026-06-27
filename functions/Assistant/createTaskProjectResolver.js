const normalizeProjectNameForLookup = value => (typeof value === 'string' ? value.trim().toLowerCase() : '')

const VERY_LOW_ROUTING_CONFIDENCE = 0.1

const PROJECT_REFERENCE_STOP_WORDS = new Set([
    'project',
    'projekt',
    'product',
    'produkt',
    'work',
    'admin',
    'private',
    'privat',
    'task',
    'tasks',
])

const normalizeTextForProjectReference = value => {
    if (typeof value !== 'string') return ''
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ')
}

const getProjectReferenceTokens = value => {
    return normalizeTextForProjectReference(value)
        .split(' ')
        .filter(token => token.length >= 4 && !PROJECT_REFERENCE_STOP_WORDS.has(token))
}

const normalizeRoutingConfidence = value => {
    if (value === undefined || value === null || value === '') return null
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue) || numericValue < 0) return null
    if (numericValue <= 1) return numericValue
    if (numericValue <= 100) return numericValue / 100
    return null
}

const reasonHasAlternativeDestinationCue = normalizedReason => {
    return /\b(rather than|instead of|not|nicht|statt|anstatt|eher|als in|better|besser|belongs|belong|gehor\w*)\b/.test(
        normalizedReason
    )
}

const reasonReferencesCurrentProject = normalizedReason => {
    return (
        /\bcurrent\b.{0,50}\bproject\b/.test(normalizedReason) ||
        /\bthis\b.{0,50}\bproject\b/.test(normalizedReason) ||
        /\bcontext\b.{0,30}\bproject\b/.test(normalizedReason) ||
        /\bkontextprojekt\b/.test(normalizedReason) ||
        /\baktuell\w*\b.{0,60}\bprojekt\b/.test(normalizedReason) ||
        /\bdies\w*\b.{0,40}\bprojekt\b/.test(normalizedReason)
    )
}

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

function getProjectFromList(projects, projectId) {
    return Array.isArray(projects) ? projects.find(project => project?.id === projectId) || null : null
}

function reasonMentionsProject(normalizedReason, projectName, { allowTokenSuffix = false } = {}) {
    const normalizedProjectName = normalizeTextForProjectReference(projectName)
    if (!normalizedProjectName) return false

    const escapedProjectName = normalizedProjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const suffixPattern = allowTokenSuffix ? '[a-z0-9]*' : ''
    const projectReferencePattern = new RegExp(`(?:^|\\s)${escapedProjectName}${suffixPattern}(?=$|\\s)`, 'g')
    let match

    while ((match = projectReferencePattern.exec(normalizedReason)) !== null) {
        const prefix = normalizedReason.slice(0, match.index).trimEnd()
        const isNegatedReference = /(?:^|\s)(?:not|nicht|rather than|instead of|statt|anstatt)(?:\s+(?:in|the|a|an|das|die|der|den|dem|ein|eine|einem|einer)){0,2}$/.test(
            prefix
        )

        if (!isNegatedReference) return true
    }

    return false
}

function findProjectReferencedByReason(projects, assistantReasoning, selectedProjectId) {
    const normalizedReason = normalizeTextForProjectReference(assistantReasoning)
    if (!normalizedReason || !Array.isArray(projects)) return null

    const candidateProjects = projects.filter(
        project => project?.id && project.id !== selectedProjectId && project.name
    )
    const exactNameMatch = candidateProjects
        .slice()
        .sort(
            (projectA, projectB) =>
                normalizeTextForProjectReference(projectB.name).length -
                normalizeTextForProjectReference(projectA.name).length
        )
        .find(project => reasonMentionsProject(normalizedReason, project.name))

    if (exactNameMatch) {
        return { project: exactNameMatch, matchType: 'projectName' }
    }

    const matchedByDistinctiveToken = []
    candidateProjects.forEach(project => {
        const projectTokens = getProjectReferenceTokens(project.name)
        if (projectTokens.some(token => reasonMentionsProject(normalizedReason, token, { allowTokenSuffix: true }))) {
            matchedByDistinctiveToken.push(project)
        }
    })

    if (matchedByDistinctiveToken.length === 1) {
        return { project: matchedByDistinctiveToken[0], matchType: 'distinctiveProjectToken' }
    }

    return null
}

function buildRoutingConsistencyCorrection({ selection, correctedProject, reason }) {
    const correctedProjectName = correctedProject.name || null
    return {
        targetProjectId: correctedProject.id,
        targetProjectName: correctedProjectName,
        source: 'routingConsistencyCorrection',
        reasoning: `The assistant routing reason pointed to ${
            correctedProjectName || 'a different project'
        }, so I corrected the task project from ${
            selection.targetProjectName || selection.targetProjectId || 'the initially selected project'
        } to ${correctedProjectName || correctedProject.id}.`,
        routingConsistencyCorrection: {
            corrected: true,
            reason,
            originalSource: selection.source,
            originalProjectId: selection.targetProjectId,
            originalProjectName: selection.targetProjectName || null,
            correctedProjectId: correctedProject.id,
            correctedProjectName,
        },
    }
}

function applyCreateTaskRoutingConsistencyCorrection(
    selection,
    { projects = [], contextProjectId = '', assistantReasoning = '', assistantConfidence = null } = {}
) {
    const normalizedReason = normalizeTextForProjectReference(assistantReasoning)
    if (!selection?.targetProjectId || !normalizedReason) return selection

    const normalizedConfidence = normalizeRoutingConfidence(assistantConfidence)
    const isVeryLowConfidence = normalizedConfidence !== null && normalizedConfidence <= VERY_LOW_ROUTING_CONFIDENCE
    const hasAlternativeDestinationCue = reasonHasAlternativeDestinationCue(normalizedReason)
    const contextProject =
        contextProjectId !== selection.targetProjectId ? getProjectFromList(projects, contextProjectId) : null
    if (
        contextProject &&
        reasonReferencesCurrentProject(normalizedReason) &&
        (isVeryLowConfidence || hasAlternativeDestinationCue)
    ) {
        return buildRoutingConsistencyCorrection({
            selection,
            correctedProject: contextProject,
            reason: 'assistant_reason_referenced_current_project',
        })
    }

    const referencedProject = findProjectReferencedByReason(projects, assistantReasoning, selection.targetProjectId)

    if (referencedProject && (isVeryLowConfidence || hasAlternativeDestinationCue)) {
        return buildRoutingConsistencyCorrection({
            selection,
            correctedProject: referencedProject.project,
            reason: `assistant_reason_${referencedProject.matchType}`,
        })
    }

    return selection
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
    {
        creatorId,
        contextProjectId,
        assistantId,
        globalProjectId,
        requestedProjectId,
        requestedProjectName,
        sourceHint,
        assistantProjectRoutingReason,
        assistantProjectRoutingConfidence,
    }
) {
    const normalizedRequestedProjectId = typeof requestedProjectId === 'string' ? requestedProjectId.trim() : ''
    const normalizedRequestedProjectName = typeof requestedProjectName === 'string' ? requestedProjectName.trim() : ''
    const normalizedSourceHint = typeof sourceHint === 'string' ? sourceHint.trim() : ''
    const normalizedAssistantReasoning =
        typeof assistantProjectRoutingReason === 'string' ? assistantProjectRoutingReason.trim() : ''
    const normalizedReasonForConsistency = normalizeTextForProjectReference(normalizedAssistantReasoning)
    const normalizedAssistantConfidence = normalizeRoutingConfidence(assistantProjectRoutingConfidence)
    const hasVeryLowAssistantConfidence =
        normalizedAssistantConfidence !== null && normalizedAssistantConfidence <= VERY_LOW_ROUTING_CONFIDENCE
    const reasonMayContradictSelection =
        reasonHasAlternativeDestinationCue(normalizedReasonForConsistency) ||
        reasonReferencesCurrentProject(normalizedReasonForConsistency) ||
        hasVeryLowAssistantConfidence
    const shouldCheckAssistantRoutingConsistency =
        !!normalizedAssistantReasoning &&
        normalizedSourceHint !== 'gmailLabelMatchedProject' &&
        reasonMayContradictSelection

    let userProjectsPromise = null
    const loadUserProjects = async () => {
        if (!creatorId) return []
        if (!userProjectsPromise) {
            const { ProjectService } = require('../shared/ProjectService')
            const projectService = new ProjectService({ database })
            userProjectsPromise = projectService.initialize().then(() =>
                projectService.getUserProjects(creatorId, {
                    includeArchived: false,
                    includeCommunity: false,
                })
            )
        }
        return userProjectsPromise
    }

    const finalizeSelection = async selection => {
        if (!shouldCheckAssistantRoutingConsistency) return selection

        try {
            const projects = await loadUserProjects()
            return applyCreateTaskRoutingConsistencyCorrection(selection, {
                projects,
                contextProjectId,
                assistantReasoning: normalizedAssistantReasoning,
                assistantConfidence: assistantProjectRoutingConfidence,
            })
        } catch (error) {
            console.warn('Error checking create_task project routing consistency:', error)
            return selection
        }
    }

    if (normalizedRequestedProjectId) {
        const targetProjectName = await fetchProjectName(database, normalizedRequestedProjectId, globalProjectId)
        return finalizeSelection(
            buildSelectionResult({
                targetProjectId: normalizedRequestedProjectId,
                targetProjectName,
                source: normalizedSourceHint || 'toolArgs.projectId',
            })
        )
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
        const projects = await loadUserProjects()

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
            return finalizeSelection(
                buildSelectionResult({
                    targetProjectId: matchingProject.id,
                    targetProjectName: matchingProject.name,
                    source: exactMatches[0] ? 'toolArgs.projectName_exact' : 'toolArgs.projectName_partial',
                    requestedProjectName: normalizedRequestedProjectName,
                })
            )
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

                return finalizeSelection(
                    buildSelectionResult({
                        targetProjectId,
                        targetProjectName,
                        source:
                            normalizedRequestedProjectName && userData?.defaultProjectId === targetProjectId
                                ? 'defaultProjectFallback'
                                : selectedCandidate.source,
                        requestedProjectName: normalizedRequestedProjectName,
                    })
                )
            }
        } catch (error) {
            console.error('Error resolving assistant project for create_task:', error)
        }
    }

    throw new Error('No project specified and no assistant project found. Please specify a projectId or projectName.')
}

module.exports = {
    applyCreateTaskRoutingConsistencyCorrection,
    buildProjectSelectionReason,
    resolveCreateTaskTargetProject,
}
