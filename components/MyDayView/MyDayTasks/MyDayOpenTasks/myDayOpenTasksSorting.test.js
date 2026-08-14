import { sortTaskByTime, sortTaskByTimeForSortingMode } from './myDayOpenTasksIntervals'

// A task whose project is absent from loggedUserProjectsMap used to throw
// "Cannot read properties of undefined (reading 'sortIndexByUser')" out of the orderBy
// comparators, which took the whole MyDayTasksLoaders subtree down to the ErrorBoundary.
const USER_ID = 'user-1'
const MAPPED_PROJECT = 'project-mapped'
const UNMAPPED_PROJECT = 'project-unmapped'

const buildUser = () => ({
    uid: USER_ID,
    guideProjectIds: [],
    firstLoginDateInDay: Date.parse('2026-08-11T08:00:00Z'),
    activeTaskStartingDate: Date.parse('2026-08-11T08:00:00Z'),
    inFocusTaskId: null,
    inFocusTaskProjectId: null,
})

const OPEN_STEP = 'openStep'

const buildTask = (id, projectId) => ({
    id,
    projectId,
    name: id,
    priority: 0,
    stepHistory: [OPEN_STEP],
    estimations: { [OPEN_STEP]: 15 },
    estimationsByObserverIds: {},
    dueDateByObserversIds: {},
    userIds: [USER_ID],
    currentReviewerId: USER_ID,
    dueDate: Date.parse('2026-08-11T20:00:00Z'),
    inDone: false,
})

const projectsMap = {
    [MAPPED_PROJECT]: { id: MAPPED_PROJECT, name: 'Mapped', sortIndexByUser: { [USER_ID]: 5 } },
}

const collectIds = ({ selectedTasks, otherTasks }) =>
    [...selectedTasks, ...otherTasks].filter(entry => entry && entry.id).map(entry => entry.id)

describe('My Day open-task sorting with an unmapped project', () => {
    it('sortTaskByTime does not throw and keeps both tasks', () => {
        const tasks = [buildTask('mapped-task', MAPPED_PROJECT), buildTask('orphan-task', UNMAPPED_PROJECT)]

        const result = sortTaskByTime(tasks, buildUser(), projectsMap)
        const ids = collectIds(result)

        expect(ids).toContain('mapped-task')
        expect(ids).toContain('orphan-task')
    })

    it('sortTaskByTimeForSortingMode does not throw and keeps both tasks', () => {
        const tasks = [buildTask('mapped-task', MAPPED_PROJECT), buildTask('orphan-task', UNMAPPED_PROJECT)]

        const result = sortTaskByTimeForSortingMode(tasks, buildUser(), projectsMap)
        const ids = collectIds(result)

        expect(ids).toContain('mapped-task')
        expect(ids).toContain('orphan-task')
    })

    it('sorts a task whose project has no sort index for this user after a mapped one', () => {
        const noIndexProject = 'project-no-index'
        const map = {
            ...projectsMap,
            [noIndexProject]: { id: noIndexProject, name: 'No index', sortIndexByUser: {} },
        }
        const tasks = [buildTask('no-index-task', noIndexProject), buildTask('mapped-task', MAPPED_PROJECT)]

        const ids = collectIds(sortTaskByTimeForSortingMode(tasks, buildUser(), map))

        expect(ids.indexOf('mapped-task')).toBeLessThan(ids.indexOf('no-index-task'))
    })
})
