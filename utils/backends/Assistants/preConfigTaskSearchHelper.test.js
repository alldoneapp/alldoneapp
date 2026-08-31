import {
    getAssistantPreConfigSearchRows,
    settlePreConfigTaskSearchSources,
    sortPreConfigTaskSearchItems,
} from './preConfigTaskSearchHelper'

describe('assistant pre-config task search helpers', () => {
    const loggedUserId = 'user-1'
    const alphaProject = {
        id: 'project-a',
        name: 'Alpha',
        index: 2,
        sortIndexByUser: { [loggedUserId]: 100 },
        globalAssistantIds: ['global-1'],
        userIds: [loggedUserId],
    }
    const betaProject = {
        id: 'project-b',
        name: 'Beta',
        index: 1,
        sortIndexByUser: { [loggedUserId]: 200 },
        globalAssistantIds: [],
        userIds: [loggedUserId],
    }
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
            loggedUserId,
        })

        expect(rows.map(row => `${row.project.id}:${row.assistant.uid}`)).toEqual([
            'project-b:local-2',
            'project-a:global-1',
            'project-a:local-1',
        ])
    })

    it('sorts task results by project, assistant, and display task order while preserving metadata', () => {
        const tasks = [
            {
                id: 'task-3',
                name: 'Third',
                order: 3,
                projectId: alphaProject.id,
                project: alphaProject,
                assistantId: globalAssistant.uid,
                assistant: globalAssistant,
                projectSearchOrder: 1,
                assistantSearchOrder: 0,
            },
            {
                id: 'task-1',
                name: 'First',
                order: 1,
                projectId: betaProject.id,
                project: betaProject,
                assistantId: betaAssistant.uid,
                assistant: betaAssistant,
                projectSearchOrder: 0,
                assistantSearchOrder: 0,
            },
            {
                id: 'task-2',
                name: 'Second',
                type: 'prompt',
                order: 2,
                projectId: alphaProject.id,
                project: alphaProject,
                assistantId: localAssistant.uid,
                assistant: localAssistant,
                projectSearchOrder: 1,
                assistantSearchOrder: 1,
            },
            {
                id: 'task-4',
                name: 'Fourth',
                type: 'external_link',
                order: 1,
                projectId: alphaProject.id,
                project: alphaProject,
                assistantId: localAssistant.uid,
                assistant: localAssistant,
                projectSearchOrder: 1,
                assistantSearchOrder: 1,
            },
        ]

        const sortedTasks = sortPreConfigTaskSearchItems(tasks, loggedUserId)

        expect(sortedTasks.map(task => task.id)).toEqual(['task-1', 'task-3', 'task-2', 'task-4'])
        expect(sortedTasks[0]).toMatchObject({
            projectId: betaProject.id,
            assistantId: betaAssistant.uid,
            project: betaProject,
            assistant: betaAssistant,
        })
    })

    it('omits readable public projects whose assistant tasks the user cannot execute', () => {
        const publicNonMemberProject = {
            id: 'public-project',
            name: 'Public',
            userIds: ['someone-else'],
            globalAssistantIds: ['global-1'],
        }

        const rows = getAssistantPreConfigSearchRows({
            loggedUserProjects: [alphaProject, publicNonMemberProject],
            projectAssistants: {
                [publicNonMemberProject.id]: [{ uid: 'local-public' }],
            },
            globalAssistants: [globalAssistant],
            loggedUserId,
        })

        expect(rows.map(row => row.project.id)).toEqual([alphaProject.id])
    })

    it('keeps successful task sources when another source is denied', async () => {
        const sources = [{ assistantId: 'allowed' }, { assistantId: 'denied' }]
        const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
        })

        const result = await settlePreConfigTaskSearchSources(sources, source => {
            if (source.assistantId === 'denied') throw denied
            return [{ id: 'task-1' }]
        })

        expect(result.loadedSources).toEqual([{ source: sources[0], tasks: [{ id: 'task-1' }], error: null }])
        expect(result.failedSources).toEqual([{ source: sources[1], tasks: [], error: denied }])
    })
})
