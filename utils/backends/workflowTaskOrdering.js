export const buildWorkflowTaskGroups = tasksByStep =>
    Object.entries(tasksByStep)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([, goalsElements]) => {
            const goalsElementsArray = Object.entries(goalsElements)
            const assigneeId = goalsElementsArray[0][1][0].userId

            return [assigneeId, goalsElementsArray]
        })
