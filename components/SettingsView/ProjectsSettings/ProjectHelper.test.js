import store from '../../../redux/store'
import ProjectHelper from './ProjectHelper'
import { PROJECT_COLOR_BLUE, PROJECT_COLOR_DEFAULT } from '../../../Themes/Modern/ProjectColors'

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn() },
}))

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
