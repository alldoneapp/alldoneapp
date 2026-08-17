/**
 * AT-2336: `filterMilestonesAndGoalsInCurrentUser` runs once per project per Firestore snapshot in
 * "All projects - Goals". It used to write five top-level redux maps unconditionally, handing every
 * MilestoneItem a brand new goals array (which re-runs its hashtag/assignee filtering effect and
 * setStates) even when nothing had changed. These tests pin the no-op guard, and that it never
 * swallows a real data change.
 */
import store from '../../redux/store'
import { setSharedData, storeCurrentUser, storeLoggedUser } from '../../redux/actions'
import { filterMilestonesAndGoalsInCurrentUser } from './GoalsHelper'

const PROJECT_ID = 'seeded-project-0'
const USER_ID = 'user-1'

const makeGoal = overrides => ({
    id: 'g1',
    name: 'Goal 1',
    extendedName: 'Goal 1',
    assigneesIds: [USER_ID],
    startingMilestoneDate: 100,
    completionMilestoneDate: 200,
    parentDoneMilestoneIds: [],
    dateByDoneMilestone: {},
    progress: 0,
    dynamicProgress: 0,
    sortIndexByMilestone: { m1: 1 },
    ...overrides,
})

const OPEN_MILESTONE = { id: 'm1', date: 200, done: false }

const boardSlices = () => {
    const state = store.getState()
    return {
        milestones: state.boardMilestonesByProject[PROJECT_ID],
        goalsByMilestone: state.boardGoalsByMilestoneByProject[PROJECT_ID],
        openAmount: state.openGoalsAmountByProject[PROJECT_ID],
    }
}

const run = (goals, openMilestones = [OPEN_MILESTONE]) =>
    filterMilestonesAndGoalsInCurrentUser(true, null, PROJECT_ID, openMilestones, [], goals)

describe('filterMilestonesAndGoalsInCurrentUser board writes (AT-2336)', () => {
    beforeAll(() => {
        store.dispatch(
            storeLoggedUser({
                uid: USER_ID,
                projectIds: [PROJECT_ID],
                realProjectIds: [PROJECT_ID],
                archivedProjectIds: [],
                templateProjectIds: [],
                unlockedKeysByGuides: {},
            })
        )
        store.dispatch(storeCurrentUser({ uid: USER_ID }))
        store.dispatch(setSharedData({ id: PROJECT_ID, name: 'Seeded' }, [], [], [], []))
    })

    it('writes the board on the first computation', () => {
        run([makeGoal()])
        const after = boardSlices()
        expect(after.milestones.map(m => m.id)).toEqual(['m1'])
        expect(after.goalsByMilestone.m1.map(g => g.id)).toEqual(['g1'])
        expect(after.openAmount).toBe(1)
    })

    it('does not rewrite redux when the same goal objects are recomputed', () => {
        const goal = makeGoal()
        run([goal])
        const before = boardSlices()

        run([goal])
        const after = boardSlices()

        // Identical object identities -> no new arrays handed to the milestone rows.
        expect(after.milestones).toBe(before.milestones)
        expect(after.goalsByMilestone).toBe(before.goalsByMilestone)
    })

    it('writes again when Firestore delivers rebuilt goal objects', () => {
        const goal = makeGoal()
        run([goal])
        const before = boardSlices()

        // mapGoalData allocates a fresh object for every snapshot, even for unchanged data.
        run([makeGoal()])
        const after = boardSlices()

        expect(after.goalsByMilestone).not.toBe(before.goalsByMilestone)
        expect(after.goalsByMilestone.m1.map(g => g.id)).toEqual(['g1'])
    })

    it('writes again when a goal is actually added', () => {
        const goal = makeGoal()
        run([goal])
        const before = boardSlices()

        const secondGoal = makeGoal({ id: 'g2', sortIndexByMilestone: { m1: 2 } })
        run([goal, secondGoal])
        const after = boardSlices()

        expect(after.goalsByMilestone).not.toBe(before.goalsByMilestone)
        expect(after.goalsByMilestone.m1.map(g => g.id).sort()).toEqual(['g1', 'g2'])
        expect(after.openAmount).toBe(2)
    })

    it('keeps skipping for a project that never contributes goals', () => {
        // The reducers delete the project key for a falsy amount / show-more flag, so this is the
        // case where "absent" and "0" must compare equal -- and it is the common case in
        // All-projects, where most projects have nothing on the board.
        run([], [])
        const before = boardSlices()
        expect(before.milestones).toEqual([])

        run([], [])
        const after = boardSlices()
        expect(after.milestones).toBe(before.milestones)
        expect(after.goalsByMilestone).toBe(before.goalsByMilestone)
    })
})
