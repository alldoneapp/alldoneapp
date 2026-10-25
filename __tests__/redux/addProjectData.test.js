/**
 * 'Add project data' inserts a project (plus its sub-stores) that was dropped from the initial
 * load by a transient read failure — the data-only sibling of 'Navigate to new project', used by
 * utils/InitialLoad/projectRecovery.js. It must not navigate and must be idempotent under races.
 */
import store from '../../redux/store'
import { addProjectData } from '../../redux/actions'

const buildProject = (id, name) => ({ id, name, userIds: ['user-1'] })

describe('Add project data reducer', () => {
    it('appends the project with the next index and seeds every sub-store', () => {
        const before = store.getState()
        const baselineCount = before.loggedUserProjects.length
        const selectedBefore = before.selectedProjectIndex

        store.dispatch(
            addProjectData(buildProject('recovered-1', 'Recovered'), [{ uid: 'user-1' }], [{ id: 'ws' }], [], [])
        )

        const state = store.getState()
        expect(state.loggedUserProjects).toHaveLength(baselineCount + 1)
        const added = state.loggedUserProjectsMap['recovered-1']
        expect(added).toBeDefined()
        expect(added.index).toBe(baselineCount)
        expect(state.loggedUserProjects[added.index]).toBe(added)
        expect(state.projectUsers['recovered-1']).toEqual([{ uid: 'user-1' }])
        expect(state.projectWorkstreams['recovered-1']).toEqual([{ id: 'ws' }])
        expect(state.projectContacts['recovered-1']).toEqual([])
        expect(state.projectAssistants['recovered-1']).toEqual([])
        expect(state.projectInvitations['recovered-1']).toEqual([])
        expect(state.projectChatNotifications['recovered-1']).toEqual({ totalUnfollowed: 0, totalFollowed: 0 })
        // Data-only: no navigation side effects.
        expect(state.selectedProjectIndex).toBe(selectedBefore)
    })

    it('is idempotent when the project is already in the map', () => {
        store.dispatch(addProjectData(buildProject('recovered-2', 'First'), [{ uid: 'user-1' }], [], [], []))
        const afterFirst = store.getState()

        store.dispatch(addProjectData(buildProject('recovered-2', 'Second'), [{ uid: 'other' }], [], [], []))
        const afterSecond = store.getState()

        expect(afterSecond.loggedUserProjects).toHaveLength(afterFirst.loggedUserProjects.length)
        expect(afterSecond.loggedUserProjectsMap['recovered-2'].name).toBe('First')
        expect(afterSecond.projectUsers['recovered-2']).toEqual([{ uid: 'user-1' }])
    })
})
