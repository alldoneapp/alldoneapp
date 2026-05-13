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
