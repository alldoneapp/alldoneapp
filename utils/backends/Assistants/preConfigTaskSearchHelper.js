export const getAssistantPreConfigSearchRows = ({
    loggedUserProjects = [],
    projectAssistants = {},
    globalAssistants = [],
    loggedUserId,
}) => {
    return sortProjectsInAppOrder(loggedUserProjects, loggedUserId)
        .filter(project => project?.id)
        .flatMap((project, projectSearchOrder) => {
            const projectSpecificAssistants = projectAssistants[project.id] || []
            const enabledGlobalAssistants = globalAssistants.filter(assistant =>
                project?.globalAssistantIds?.includes(assistant.uid)
            )

            return [...enabledGlobalAssistants, ...projectSpecificAssistants]
                .filter(assistant => assistant?.uid)
                .map((assistant, assistantSearchOrder) => ({
                    project,
                    assistant,
                    projectSearchOrder,
                    assistantSearchOrder,
                }))
        })
}

export const sortPreConfigTaskSearchItems = (tasks, loggedUserId) => {
    return [...tasks].sort((a, b) => {
        const projectDiff = compareProjectsInAppOrder(a, b, loggedUserId)
        if (projectDiff !== 0) return projectDiff

        const assistantOrderDiff = getSearchOrder(a.assistantSearchOrder) - getSearchOrder(b.assistantSearchOrder)
        if (assistantOrderDiff !== 0) return assistantOrderDiff

        const assistantNameDiff = (a.assistant?.displayName || a.assistant?.name || '').localeCompare(
            b.assistant?.displayName || b.assistant?.name || ''
        )
        if (assistantNameDiff !== 0) return assistantNameDiff

        const typeDiff = getTaskTypeRank(a.type) - getTaskTypeRank(b.type)
        if (typeDiff !== 0) return typeDiff

        return (a.order ?? 0) - (b.order ?? 0)
    })
}

const DEFAULT_SEARCH_ORDER = 999999

const getSearchOrder = value => (value === undefined || value === null ? DEFAULT_SEARCH_ORDER : value)

const getProjectSortIndex = (project, loggedUserId) => {
    const sortIndexByUser = project?.sortIndexByUser || {}
    return loggedUserId ? sortIndexByUser[loggedUserId] : undefined
}

const sortProjectsInAppOrder = (projects, loggedUserId) => {
    return [...projects].sort((a, b) => compareProjectDataInAppOrder(a, b, loggedUserId))
}

const compareProjectsInAppOrder = (a, b, loggedUserId) => {
    const projectSearchOrderDiff = getSearchOrder(a.projectSearchOrder) - getSearchOrder(b.projectSearchOrder)
    if (projectSearchOrderDiff !== 0) return projectSearchOrderDiff

    return compareProjectDataInAppOrder(a.project, b.project, loggedUserId)
}

const compareProjectDataInAppOrder = (a, b, loggedUserId) => {
    const aSortIndex = getProjectSortIndex(a, loggedUserId)
    const bSortIndex = getProjectSortIndex(b, loggedUserId)
    const aHasSortIndex = aSortIndex !== undefined && aSortIndex !== null
    const bHasSortIndex = bSortIndex !== undefined && bSortIndex !== null

    if (aHasSortIndex && bHasSortIndex && aSortIndex !== bSortIndex) return bSortIndex - aSortIndex
    if (aHasSortIndex && !bHasSortIndex) return -1
    if (!aHasSortIndex && bHasSortIndex) return 1

    const nameDiff = (a?.name || '').localeCompare(b?.name || '')
    if (nameDiff !== 0) return nameDiff

    return (a?.index ?? DEFAULT_SEARCH_ORDER) - (b?.index ?? DEFAULT_SEARCH_ORDER)
}

const getTaskTypeRank = value => {
    if (!value) return 1
    return value === 'prompt' ? 0 : 1
}
