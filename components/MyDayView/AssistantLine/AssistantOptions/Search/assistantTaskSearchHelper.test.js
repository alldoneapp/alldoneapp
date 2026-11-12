import { filterPreConfigTaskSearchItems, groupPreConfigTaskSearchItems } from './assistantTaskSearchHelper'
import { preferAssistantTasks } from './assistantTaskSearchHelper'

describe('assistant task search UI helpers', () => {
    const alphaProject = { id: 'project-a', name: 'Alpha', index: 2 }
    const betaProject = { id: 'project-b', name: 'Beta', index: 1 }
    const globalAssistant = { uid: 'global-1', displayName: 'Global Helper', order: 2 }
    const localAssistant = { uid: 'local-1', displayName: 'Local Helper', order: 1 }
    const betaAssistant = { uid: 'local-2', displayName: 'Beta Helper', order: 1 }

    it('filters by task, assistant, and project names and groups by project and assistant', () => {
        const tasks = [
            {
                id: 'task-1',
                name: 'Write summary',
                projectId: alphaProject.id,
                project: alphaProject,
                assistantId: localAssistant.uid,
                assistant: localAssistant,
            },
            {
                id: 'task-2',
                name: 'Prepare report',
                projectId: alphaProject.id,
                project: alphaProject,
                assistantId: globalAssistant.uid,
                assistant: globalAssistant,
            },
            {
                id: 'task-3',
                name: 'Schedule call',
                projectId: betaProject.id,
                project: betaProject,
                assistantId: betaAssistant.uid,
                assistant: betaAssistant,
            },
        ]

        expect(filterPreConfigTaskSearchItems(tasks, 'global')).toEqual([tasks[1]])
        expect(filterPreConfigTaskSearchItems(tasks, 'beta')).toEqual([tasks[2]])

        const groups = groupPreConfigTaskSearchItems(tasks)
        expect(groups).toHaveLength(2)
        expect(groups[0].project.id).toBe(alphaProject.id)
        expect(groups[0].assistants.map(group => group.assistant.uid)).toEqual(['local-1', 'global-1'])
    })
})

describe('preferAssistantTasks', () => {
    const tasks = [
        { id: 'a', assistantId: 'other', projectId: 'p1' },
        { id: 'b', assistantId: 'anna', projectId: 'p2' },
        { id: 'c', assistantId: 'other', projectId: 'p2' },
        { id: 'd', assistantId: 'anna', projectId: 'p1' },
        { id: 'e', assistantId: 'anna', projectId: 'p1' },
    ]

    it('lists the line assistant in its project first, then elsewhere, keeping the rest in order', () => {
        expect(preferAssistantTasks(tasks, 'anna', 'p1').map(task => task.id)).toEqual(['d', 'e', 'b', 'a', 'c'])
    })

    it('leaves the order alone without an assistant', () => {
        expect(preferAssistantTasks(tasks, null, 'p1')).toBe(tasks)
    })
})
