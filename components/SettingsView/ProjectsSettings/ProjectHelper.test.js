import store from '../../../redux/store'
import ProjectHelper from './ProjectHelper'
import { PROJECT_COLOR_BLUE, PROJECT_COLOR_DEFAULT } from '../../../Themes/Modern/ProjectColors'
import { orderBy } from 'lodash'
import { sortProjectsInListOrder } from '../../../functions/shared/projectListOrder'

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn() },
}))

jest.mock('./ProjectsSettings', () => ({
    PROJECT_TYPE_ACTIVE: 'active',
    PROJECT_TYPE_ARCHIVED: 'archived',
    PROJECT_TYPE_TEMPLATE: 'template',
    PROJECT_TYPE_SHARED: 'shared',
    PROJECT_TYPE_GUIDE: 'guide',
}))
jest.mock('../../../utils/BackendBridge', () => ({}))

describe('ProjectHelper.getProjectColorById', () => {
    it('returns the stored color for a loaded project', () => {
        store.getState.mockReturnValue({
            loggedUserProjectsMap: { 'project-1': { id: 'project-1', color: PROJECT_COLOR_BLUE } },
        })

        expect(ProjectHelper.getProjectColorById('project-1')).toBe(PROJECT_COLOR_BLUE)
    })

    it('uses the default project color while project data is temporarily missing', () => {
        store.getState.mockReturnValue({ loggedUserProjectsMap: {} })

        expect(ProjectHelper.getProjectColorById('missing-project')).toBe(PROJECT_COLOR_DEFAULT)
    })

    it('does not expose an unknown color as a PROJECT_COLOR_SYSTEM key', () => {
        store.getState.mockReturnValue({
            loggedUserProjectsMap: { 'project-1': { id: 'project-1', color: 'unknown-color' } },
        })

        expect(ProjectHelper.getProjectColorById('project-1')).toBe(PROJECT_COLOR_DEFAULT)
    })
})

describe('ProjectHelper.getGlobalFeedProjects', () => {
    const user = {
        uid: 'member',
        projectIds: ['active', 'archived', 'template', 'community', 'revoked'],
        archivedProjectIds: ['archived'],
        templateProjectIds: ['template'],
        guideProjectIds: ['community', 'unjoined-community'],
    }
    const projects = ['active', 'archived', 'template', 'community', 'shared', 'revoked', 'unjoined-community'].map(
        id => ({
            id,
            userIds: id === 'revoked' || id === 'unjoined-community' ? ['someone-else'] : ['member'],
        })
    )

    it('preserves active + joined community scope and excludes archived/templates/shared projects', () => {
        expect(ProjectHelper.getGlobalFeedProjects(projects, user).map(project => project.id)).toEqual([
            'active',
            'community',
        ])
    })

    it('requires membership even when stale user navigation lists contain a project', () => {
        expect(
            ProjectHelper.getGlobalFeedProjects([...projects, { id: 'missing-membership' }], {
                ...user,
                projectIds: [...user.projectIds, 'missing-membership'],
            }).map(project => project.id)
        ).toEqual(['active', 'community'])
        expect(ProjectHelper.getGlobalFeedProjects(projects, { ...user, uid: 'outsider' })).toEqual([])
    })
})

// AT-3085: the sidebar now sorts with the shared helper the focus-task pickers use. It must keep the
// exact order of the lodash orderBy it replaced, edge cases included.
describe('the shared project-list order keeps the sidebar order', () => {
    const userId = 'u1'
    const legacySort = projects =>
        orderBy(
            projects,
            [project => project.sortIndexByUser[userId], project => project.name.toLowerCase()],
            ['desc', 'asc']
        )

    test('matches the previous lodash sort for numbers, ties, missing values and case', () => {
        // No NaN here: lodash orders two NaN indexes inconsistently (its comparator says 1 both ways).
        const values = [5, 5, 10, 0, -3, undefined, null, 1794469266610, 1794469266599]
        const names = ['Beta', 'alpha', 'Alpha', 'JTL', 'privat', 'Zeta', 'b', 'A']
        let seed = 7
        const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
        for (let round = 0; round < 200; round++) {
            const projects = Array.from({ length: 1 + Math.floor(random() * 8) }, (_, index) => ({
                id: `p${round}-${index}`,
                name: names[Math.floor(random() * names.length)],
                sortIndexByUser: { [userId]: values[Math.floor(random() * values.length)] },
            }))
            expect(sortProjectsInListOrder(projects, userId).map(p => p.id)).toEqual(
                legacySort(projects).map(p => p.id)
            )
        }
    })

    test('matches it for a single NaN index too (first, like a missing one)', () => {
        const projects = [
            { id: 'a', name: 'A', sortIndexByUser: { [userId]: 3 } },
            { id: 'nan', name: 'Nan', sortIndexByUser: { [userId]: NaN } },
            { id: 'none', name: 'None', sortIndexByUser: {} },
        ]
        expect(sortProjectsInListOrder(projects, userId).map(p => p.id)).toEqual(legacySort(projects).map(p => p.id))
    })

    test('is what ProjectHelper.sortProjects uses', () => {
        const projects = [
            { id: 'privat', name: 'Privat', sortIndexByUser: { [userId]: 1 } },
            { id: 'jtl', name: 'JTL', sortIndexByUser: { [userId]: 30 } },
        ]
        expect(ProjectHelper.sortProjects(projects, userId).map(p => p.id)).toEqual(['jtl', 'privat'])
    })
})
