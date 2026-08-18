'use strict'

const mockResponsesCreate = jest.fn()
const mockDeductGold = jest.fn()
const mockAddProjectRoutingReasonComment = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))
jest.mock('../Assistant/assistantHelper', () => ({
    calculateGoldCostFromTokens: jest.fn(() => 2),
    getCachedEnvFunctions: jest.fn(() => ({ OPEN_AI_KEY: 'test-key' })),
    getModel: jest.fn(() => 'gpt-5.6-luna'),
    getOpenAIClient: jest.fn(() => ({ responses: { create: mockResponsesCreate } })),
    moveTaskToDifferentProject: jest.fn(),
}))
jest.mock('../Gold/goldHelper', () => ({
    deductGold: (...args) => mockDeductGold(...args),
}))
jest.mock('../shared/projectRoutingCommentHelper', () => ({
    addProjectRoutingReasonComment: (...args) => mockAddProjectRoutingReasonComment(...args),
}))

const {
    chooseRoutingAction,
    isPendingProjectRouting,
    normalizeClassificationResult,
    routeNewTaskToProject,
    selectCandidateProjects,
} = require('./taskProjectRouting')

const createSnapshot = (id, data) => ({ id, exists: data !== undefined, data: () => data })

const createDb = ({ gold = 100, projects, task } = {}) => {
    const state = {
        projects: projects || {
            home: { name: 'Personal', description: 'Errands and private life' },
            work: { name: 'Alldone Product', description: 'Building the Alldone app' },
        },
        users: {
            user1: {
                gold,
                displayName: 'Karsten',
                defaultProjectId: 'home',
                projectIds: ['home', 'work'],
            },
        },
        tasks: {
            task1: task || {
                id: 'task1',
                name: 'Fix the task list scroll bug',
                creatorId: 'user1',
                projectRouting: { status: 'pending', source: 'automatic_project_option', hostProjectId: 'home' },
            },
        },
    }

    const readPath = path => {
        const [collection, id, sub, subId] = path.split('/')
        if (collection === 'projects') return createSnapshot(id, state.projects[id])
        if (collection === 'users') return createSnapshot(id, state.users[id])
        if (collection === 'items' && sub === 'tasks') return createSnapshot(subId, state.tasks[subId])
        return createSnapshot(id, undefined)
    }

    const db = {
        state,
        doc: path => ({
            id: path,
            path,
            get: async () => readPath(path),
            update: async data => {
                const [, , , taskId] = path.split('/')
                state.tasks[taskId] = { ...state.tasks[taskId], ...data }
            },
        }),
        collection: () => ({ doc: () => ({ id: 'claim-1' }) }),
        runTransaction: async handler =>
            handler({
                get: async ref => readPath(ref.path),
                update: (ref, data) => {
                    const [, , , taskId] = ref.path.split('/')
                    state.tasks[taskId] = { ...state.tasks[taskId], ...data }
                },
            }),
    }
    return db
}

const classification = ({
    projectId = 'work',
    confidence = 0.95,
    alternativeProjectId = 'home',
    alternativeConfidence = 0.2,
} = {}) => ({
    result: {
        projectId,
        confidence,
        alternativeProjectId,
        alternativeConfidence,
        reason: 'It is app development work.',
    },
    totalTokens: 400,
})

describe('taskProjectRouting guards', () => {
    it('only routes tasks the user asked to route', () => {
        expect(isPendingProjectRouting({ projectRouting: { status: 'pending' } })).toBe(true)
        expect(isPendingProjectRouting({ projectRouting: { status: 'routed' } })).toBe(false)
        expect(isPendingProjectRouting({})).toBe(false)
    })

    it('keeps the task where it is unless the choice is confident and clear', () => {
        expect(chooseRoutingAction({ projectId: 'work', confidence: 0.95, alternativeConfidence: 0.1 }, 'home')).toBe(
            'move'
        )
        // Same project: nothing to do.
        expect(chooseRoutingAction({ projectId: 'home', confidence: 0.99, alternativeConfidence: 0 }, 'home')).toBe(
            'keep'
        )
        expect(chooseRoutingAction({ projectId: 'work', confidence: 0.4, alternativeConfidence: 0 }, 'home')).toBe(
            'keep'
        )
        // A coin flip between two projects is not a decision.
        expect(chooseRoutingAction({ projectId: 'work', confidence: 0.72, alternativeConfidence: 0.7 }, 'home')).toBe(
            'keep'
        )
        expect(chooseRoutingAction({ projectId: null, confidence: 0, alternativeConfidence: 0 }, 'home')).toBe('keep')
    })

    it('refuses ids the classifier invented', () => {
        const result = normalizeClassificationResult(
            { projectId: 'made-up', confidence: 0.9, alternativeProjectId: 'work', alternativeConfidence: 0.5 },
            ['home', 'work']
        )
        expect(result.projectId).toBeNull()
        expect(result.confidence).toBe(0)
        expect(result.alternativeProjectId).toBe('work')
    })

    it('always keeps the host project among the candidates it trims to', () => {
        const projects = Array.from({ length: 60 }, (_, index) => ({
            id: `project-${index}`,
            name: `Project ${index}`,
            description: '',
        }))
        const selected = selectCandidateProjects({ name: 'unrelated words' }, projects, 'project-59', 5)
        expect(selected).toHaveLength(5)
        expect(selected.some(project => project.id === 'project-59')).toBe(true)
    })
})

describe('routeNewTaskToProject', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDeductGold.mockResolvedValue({ success: true, amount: 2 })
    })

    it('moves the task to the classified project and explains why in the target project', async () => {
        const db = createDb()
        const move = jest.fn().mockResolvedValue({ moved: true })

        const result = await routeNewTaskToProject({
            task: db.state.tasks.task1,
            projectId: 'home',
            db,
            classify: async () => classification(),
            move,
        })

        expect(result).toEqual({ action: 'moved', targetProjectId: 'work' })
        expect(move).toHaveBeenCalledWith(
            expect.objectContaining({ sourceProjectId: 'home', targetProjectId: 'work', taskId: 'task1' })
        )
        // Settled BEFORE the move, so the copy that lands in the target project
        // is no longer pending and cannot route itself a second time.
        expect(db.state.tasks.task1.projectRouting.status).toBe('routed')
        expect(isPendingProjectRouting(db.state.tasks.task1)).toBe(false)
        expect(mockAddProjectRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: 'work', taskId: 'task1', source: 'task_project_routing' })
        )
        // The Gold entry names the project the task ended up in, so its history
        // link still resolves after the move.
        expect(mockDeductGold).toHaveBeenCalledWith(
            'user1',
            2,
            expect.objectContaining({ source: 'task_project_routing', projectId: 'work', objectId: 'task1' })
        )
    })

    it('leaves an unconfident task in its host project without a comment', async () => {
        const db = createDb()
        const move = jest.fn()

        const result = await routeNewTaskToProject({
            task: db.state.tasks.task1,
            projectId: 'home',
            db,
            classify: async () => classification({ confidence: 0.5 }),
            move,
        })

        expect(result).toEqual({ action: 'kept', targetProjectId: 'home' })
        expect(move).not.toHaveBeenCalled()
        expect(db.state.tasks.task1.projectRouting.status).toBe('kept')
        expect(mockAddProjectRoutingReasonComment).not.toHaveBeenCalled()
    })

    it('does nothing at all for a task created in a normally picked project', async () => {
        const db = createDb({ task: { id: 'task1', name: 'Buy milk', creatorId: 'user1' } })
        const classify = jest.fn()

        const result = await routeNewTaskToProject({ task: db.state.tasks.task1, projectId: 'home', db, classify })

        expect(result).toEqual({ action: 'skipped' })
        expect(classify).not.toHaveBeenCalled()
        expect(mockDeductGold).not.toHaveBeenCalled()
    })

    it('does not spend Gold it does not have', async () => {
        const db = createDb({ gold: 0 })
        const classify = jest.fn()

        const result = await routeNewTaskToProject({ task: db.state.tasks.task1, projectId: 'home', db, classify })

        expect(result).toEqual({ action: 'insufficient_gold' })
        expect(classify).not.toHaveBeenCalled()
    })

    it('keeps the task usable when the move itself fails', async () => {
        const db = createDb()
        const move = jest.fn().mockRejectedValue(new Error('target project vanished'))

        const result = await routeNewTaskToProject({
            task: db.state.tasks.task1,
            projectId: 'home',
            db,
            classify: async () => classification(),
            move,
        })

        expect(result).toEqual({ action: 'kept', targetProjectId: 'home' })
        expect(mockDeductGold).toHaveBeenCalledWith('user1', 2, expect.objectContaining({ projectId: 'home' }))
    })

    it('keeps the task when a failing classification would otherwise leave it pending forever', async () => {
        const db = createDb()

        const result = await routeNewTaskToProject({
            task: db.state.tasks.task1,
            projectId: 'home',
            db,
            classify: async () => {
                throw new Error('openai is down')
            },
        })

        expect(result).toEqual({ action: 'failed' })
        expect(db.state.tasks.task1.projectRouting.status).toBe('failed')
        expect(isPendingProjectRouting(db.state.tasks.task1)).toBe(false)
    })

    it('skips routing when the user has only one project to choose from', async () => {
        const db = createDb({ projects: { home: { name: 'Personal' } } })
        db.state.users.user1.projectIds = ['home']
        const classify = jest.fn()

        const result = await routeNewTaskToProject({ task: db.state.tasks.task1, projectId: 'home', db, classify })

        expect(result).toEqual({ action: 'no_candidates' })
        expect(classify).not.toHaveBeenCalled()
        expect(db.state.tasks.task1.projectRouting.status).toBe('kept')
    })
})
