export const getAssistantPreConfigSearchRows = ({
    loggedUserProjects = [],
    projectAssistants = {},
    globalAssistants = [],
}) => {
    return loggedUserProjects
        .filter(project => project?.id)
        .sort((a, b) => (a.index ?? 999) - (b.index ?? 999))
        .flatMap(project => {
            const projectSpecificAssistants = projectAssistants[project.id] || []
            const enabledGlobalAssistants = globalAssistants.filter(assistant =>
                project?.globalAssistantIds?.includes(assistant.uid)
            )

            return [...projectSpecificAssistants, ...enabledGlobalAssistants]
                .filter(assistant => assistant?.uid)
                .sort((a, b) => {
                    const orderDiff = (a.order ?? a.index ?? 999) - (b.order ?? b.index ?? 999)
                    if (orderDiff !== 0) return orderDiff
                    return (a.displayName || a.name || '').localeCompare(b.displayName || b.name || '')
                })
                .map(assistant => ({ project, assistant }))
        })
}

export const sortPreConfigTaskSearchItems = tasks => {
    return [...tasks].sort((a, b) => {
        const projectDiff = (a.project?.index ?? 999) - (b.project?.index ?? 999)
        if (projectDiff !== 0) return projectDiff

        const assistantOrderDiff =
            (a.assistant?.order ?? a.assistant?.index ?? 999) - (b.assistant?.order ?? b.assistant?.index ?? 999)
        if (assistantOrderDiff !== 0) return assistantOrderDiff

        const assistantNameDiff = (a.assistant?.displayName || a.assistant?.name || '').localeCompare(
            b.assistant?.displayName || b.assistant?.name || ''
        )
        if (assistantNameDiff !== 0) return assistantNameDiff

        return (a.order ?? 0) - (b.order ?? 0)
    })
}
