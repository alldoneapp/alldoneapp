const matchesSearch = (value, searchText) => (value || '').toLowerCase().includes(searchText)

export const filterPreConfigTaskSearchItems = (tasks, searchText) => {
    const cleanedText = searchText.trim().toLowerCase()
    if (!cleanedText) return tasks

    return tasks.filter(task => {
        return (
            matchesSearch(task.name, cleanedText) ||
            matchesSearch(task.assistant?.displayName || task.assistant?.name, cleanedText) ||
            matchesSearch(task.project?.name, cleanedText)
        )
    })
}

export const groupPreConfigTaskSearchItems = tasks => {
    const projects = []
    const projectsMap = {}

    tasks.forEach(task => {
        const projectId = task.projectId
        const assistantId = task.assistantId
        if (!projectId || !assistantId) return

        if (!projectsMap[projectId]) {
            const projectGroup = {
                project: task.project,
                assistants: [],
                assistantsMap: {},
            }
            projectsMap[projectId] = projectGroup
            projects.push(projectGroup)
        }

        const projectGroup = projectsMap[projectId]
        if (!projectGroup.assistantsMap[assistantId]) {
            const assistantGroup = {
                assistant: task.assistant,
                tasks: [],
            }
            projectGroup.assistantsMap[assistantId] = assistantGroup
            projectGroup.assistants.push(assistantGroup)
        }

        projectGroup.assistantsMap[assistantId].tasks.push(task)
    })

    return projects
}

/**
 * Puts the tasks of the assistant the composer is talking to first (in the project it is talking
 * in, then that assistant elsewhere), keeping the existing order otherwise. Grouping preserves
 * insertion order, so that project and that assistant open the list.
 */
export const preferAssistantTasks = (tasks, assistantId, projectId) => {
    if (!assistantId) return tasks
    const rank = task => {
        if (task.assistantId !== assistantId) return 2
        return projectId && task.projectId === projectId ? 0 : 1
    }
    return tasks
        .map((task, index) => ({ task, index, rank: rank(task) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map(({ task }) => task)
}
