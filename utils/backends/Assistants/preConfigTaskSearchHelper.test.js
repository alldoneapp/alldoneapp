import { getAssistantPreConfigSearchRows, sortPreConfigTaskSearchItems } from './preConfigTaskSearchHelper'

describe('assistant pre-config task search helpers', () => {
    const alphaProject = { id: 'project-a', name: 'Alpha', index: 2, globalAssistantIds: ['global-1'] }
    const betaProject = { id: 'project-b', name: 'Beta', index: 1, globalAssistantIds: [] }
    const globalAssistant = { uid: 'global-1', displayName: 'Global Helper', order: 2 }
    const localAssistant = { uid: 'local-1', displayName: 'Local Helper', order: 1 }
    const betaAssistant = { uid: 'local-2', displayName: 'Beta Helper', order: 1 }

    it('builds assistant/project rows for accessible projects and enabled global assistants', () => {
        const rows = getAssistantPreConfigSearchRows({
            loggedUserProjects: [alphaProject, betaProject],
            projectAssistants: {
                'project-a': [localAssistant],
                'project-b': [betaAssistant],
            },
            globalAssistants: [globalAssistant],
        })

        expect(rows.map(row => `${row.project.id}:${row.assistant.uid}`)).toEqual([
            'project-b:local-2',
            'project-a:local-1',
            'project-a:global-1',
        ])
    })

    it('sorts task results by project, assistant, and task order while preserving metadata', () => {
        const tasks = [
            {
                id: 'task-3',
                name: 'Third',
                order: 3,
                projectId: alphaProject.id,
                project: alphaProject,
                assistantId: globalAssistant.uid,
                assistant: globalAssistant,
            },
            {
                id: 'task-1',
                name: 'First',
                order: 1,
                projectId: betaProject.id,
                project: betaProject,
                assistantId: betaAssistant.uid,
                assistant: betaAssistant,
            },
            {
                id: 'task-2',
                name: 'Second',
                order: 2,
                projectId: alphaProject.id,
                project: alphaProject,
                assistantId: localAssistant.uid,
                assistant: localAssistant,
            },
        ]

        const sortedTasks = sortPreConfigTaskSearchItems(tasks)

        expect(sortedTasks.map(task => task.id)).toEqual(['task-1', 'task-2', 'task-3'])
        expect(sortedTasks[0]).toMatchObject({
            projectId: betaProject.id,
            assistantId: betaAssistant.uid,
            project: betaProject,
            assistant: betaAssistant,
        })
    })
})
