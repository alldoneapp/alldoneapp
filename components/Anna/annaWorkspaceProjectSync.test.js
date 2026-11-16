import {
    getAnnaWorkspacePlanKey,
    getAnnaWorkspaceProjectKey,
    planAnnaWorkspaceProjectSync,
    resolveAnnaChoiceForWorkspace,
    syncAnnaWorkspaceProject,
} from './annaWorkspaceProjectSync'
import { ANNA_AUTOMATIC_PROJECT } from './annaProjectSelection'

jest.mock('../../redux/actions', () => ({
    setSelectedSidebarTab: tab => ({ type: 'SIDEBAR_TAB', tab }),
    setSelectedTypeOfProject: projectType => ({ type: 'PROJECT_TYPE', projectType }),
    storeCurrentUser: user => ({ type: 'CURRENT_USER', user }),
    storeLoggedUser: user => ({ type: 'LOGGED_USER', user }),
    switchProject: index => ({ type: 'PROJECT', index }),
}))

// AT-3036: the Alldone workspace follows the project the assistant chat continues in.
const loggedUser = { uid: 'u1', defaultProjectId: 'home' }
const projects = [
    { id: 'home', index: 0 },
    { id: 'product', index: 1 },
    { id: 'steercom', index: 2 },
]
const state = (overrides = {}) => ({
    loggedUser,
    loggedUserProjects: projects,
    loggedUserProjectsMap: Object.fromEntries(projects.map(project => [project.id, project])),
    selectedProjectIndex: 1,
    route: 'ROOT_TASKS',
    selectedSidebarTab: 'ROOT_TASKS',
    ...overrides,
})

describe('planAnnaWorkspaceProjectSync', () => {
    it('moves the workspace to the chosen project and keeps the kind of view', () => {
        expect(planAnnaWorkspaceProjectSync(state({ selectedSidebarTab: 'ROOT_NOTES' }), 'steercom')).toEqual({
            projectIndex: 2,
            projectId: 'steercom',
            tab: 'ROOT_NOTES',
            navigateToRoot: false,
            currentUser: loggedUser,
        })
    })

    it('does nothing when the workspace already shows that project (no navigation loop)', () => {
        expect(planAnnaWorkspaceProjectSync(state(), 'product')).toBeNull()
        // An object's detail view inside that project stays open, too.
        expect(planAnnaWorkspaceProjectSync(state({ route: 'TaskDetailedView' }), 'product')).toBeNull()
    })

    it('leaves an object of the previous project for the list of the same kind', () => {
        expect(
            planAnnaWorkspaceProjectSync(state({ route: 'TaskDetailedView', selectedSidebarTab: 'ROOT_GOALS' }), 'home')
        ).toMatchObject({ projectIndex: 0, tab: 'ROOT_GOALS', navigateToRoot: true, currentUser: { uid: 'allGoals' } })
    })

    it('matches "Automatic" with All projects or the default project, and otherwise opens All projects', () => {
        expect(planAnnaWorkspaceProjectSync(state({ selectedProjectIndex: -1 }), ANNA_AUTOMATIC_PROJECT)).toBeNull()
        expect(planAnnaWorkspaceProjectSync(state({ selectedProjectIndex: 0 }), ANNA_AUTOMATIC_PROJECT)).toBeNull()
        expect(planAnnaWorkspaceProjectSync(state({ selectedProjectIndex: 0 }), null)).toBeNull()
        expect(
            planAnnaWorkspaceProjectSync(state({ selectedSidebarTab: 'ROOT_WIKI' }), ANNA_AUTOMATIC_PROJECT)
        ).toEqual({
            projectIndex: -1,
            projectId: null,
            // All projects has no wiki.
            tab: 'ROOT_TASKS',
            navigateToRoot: false,
            currentUser: loggedUser,
        })
    })

    it('opens an explicitly chosen default project, not All projects', () => {
        expect(planAnnaWorkspaceProjectSync(state({ selectedProjectIndex: -1 }), 'home')).toMatchObject({
            projectIndex: 0,
            projectId: 'home',
        })
    })

    it('does nothing for a project the workspace does not know (yet)', () => {
        expect(planAnnaWorkspaceProjectSync(state(), 'unknown')).toBeNull()
        expect(planAnnaWorkspaceProjectSync({}, 'steercom')).toBeNull()
    })
})

describe('syncAnnaWorkspaceProject', () => {
    it('dispatches one batch like the header project picker, navigating to the root first when needed', () => {
        const dispatch = jest.fn()
        const navigate = jest.fn()
        const current = state({ route: 'NoteDetailedView', loggedUser: { ...loggedUser, showAllProjectsByTime: true } })
        syncAnnaWorkspaceProject('steercom', { getState: () => current, dispatch, navigate })
        expect(navigate).toHaveBeenCalledWith('Root')
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls[0][0]).toEqual([
            { type: 'LOGGED_USER', user: { ...loggedUser, showAllProjectsByTime: false } },
            { type: 'PROJECT', index: 2 },
            { type: 'CURRENT_USER', user: current.loggedUser },
            { type: 'PROJECT_TYPE', projectType: 'active' },
            { type: 'SIDEBAR_TAB', tab: 'ROOT_TASKS' },
        ])
    })

    it('dispatches nothing when the workspace already matches', () => {
        const dispatch = jest.fn()
        const navigate = jest.fn()
        expect(syncAnnaWorkspaceProject('product', { getState: () => state(), dispatch, navigate })).toBeNull()
        expect(dispatch).not.toHaveBeenCalled()
        expect(navigate).not.toHaveBeenCalled()
    })
})

// AT-3036 follow-up: the other direction, the chat follows a project opened in the workspace.
describe('getAnnaWorkspaceProjectKey', () => {
    it('names the project (or All projects) of a root view, and nothing for a detail view', () => {
        expect(getAnnaWorkspaceProjectKey(state())).toBe('product')
        expect(getAnnaWorkspaceProjectKey(state({ selectedProjectIndex: -1 }))).toBe(':all')
        expect(getAnnaWorkspaceProjectKey(state({ route: 'TaskDetailedView' }))).toBeNull()
        expect(getAnnaWorkspaceProjectKey({})).toBeNull()
    })

    it('matches the key a sync plan lands on', () => {
        expect(getAnnaWorkspacePlanKey(planAnnaWorkspaceProjectSync(state(), 'steercom'))).toBe('steercom')
        expect(getAnnaWorkspacePlanKey(planAnnaWorkspaceProjectSync(state(), ANNA_AUTOMATIC_PROJECT))).toBe(':all')
        expect(getAnnaWorkspacePlanKey(null)).toBeNull()
    })
})

describe('resolveAnnaChoiceForWorkspace', () => {
    const user = { uid: 'u1', defaultProjectId: 'home', projectIds: ['home', 'product', 'steercom', 'old'] }
    const resolve = (
        workspaceKey,
        choiceId = ANNA_AUTOMATIC_PROJECT,
        isDefault = choiceId === ANNA_AUTOMATIC_PROJECT
    ) => resolveAnnaChoiceForWorkspace({ user, workspaceKey, choiceId, isDefault })

    it("picks the opened project's chat, whose assistant answers there", () => {
        expect(resolve('steercom')).toBe('steercom')
        expect(resolve('steercom', 'product', false)).toBe('steercom')
    })

    it('keeps the chat when it already continues in that project', () => {
        expect(resolve('product', 'product', false)).toBeNull()
    })

    it('means "Automatic" for All projects and the default project, keeping an explicit default pick', () => {
        expect(resolve(':all', 'product', false)).toBe(ANNA_AUTOMATIC_PROJECT)
        expect(resolve('home', 'product', false)).toBe(ANNA_AUTOMATIC_PROJECT)
        expect(resolve(':all')).toBeNull()
        expect(resolve(':all', 'home', true)).toBeNull()
        expect(resolve('home', 'home', true)).toBeNull()
    })

    it('changes nothing for a project the chat cannot continue in', () => {
        expect(
            resolveAnnaChoiceForWorkspace({
                user: { ...user, archivedProjectIds: ['old'] },
                workspaceKey: 'old',
                choiceId: 'product',
                isDefault: false,
            })
        ).toBeNull()
        expect(resolve('foreign', 'product', false)).toBeNull()
        expect(resolve(null, 'product', false)).toBeNull()
    })
})
