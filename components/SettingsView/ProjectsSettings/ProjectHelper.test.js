import store from '../../../redux/store'
import ProjectHelper from './ProjectHelper'
import { PROJECT_COLOR_BLUE, PROJECT_COLOR_DEFAULT } from '../../../Themes/Modern/ProjectColors'

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
