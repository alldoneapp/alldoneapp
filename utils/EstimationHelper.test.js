/**
 * Regression tests for the production crash "Cannot read properties of undefined
 * (reading 'estimationType')" in generateDateHeaderText.
 *
 * During initial load a task-list date header can render for a project id that is
 * not (yet) in loggedUserProjectsMap — e.g. a stale projectId whose project doc was
 * deleted and therefore skipped by InitialLoad. ProjectHelper.getProjectById returns
 * undefined for those, and the estimation helpers must fall back to the time-based
 * default instead of crashing.
 */
import ProjectHelper from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import {
    generateDateHeaderText,
    generateDateHeaderTextInMyDaySection,
    getEstimationResume,
    ESTIMATION_TYPE_POINTS,
} from './EstimationHelper'

jest.mock('../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: jest.fn(),
}))

jest.mock('../components/TaskListView/Utils/TasksHelper', () => ({
    BACKLOG_DATE_STRING: 'BACKLOG',
}))

jest.mock('../i18n/TranslationService', () => ({
    translate: key => key,
}))

jest.mock('../redux/store', () => ({
    getState: () => ({ loggedUserProjects: [] }),
}))

jest.mock('../components/UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD/MM/YYYY',
}))

describe('estimation helpers when the project is missing from the store', () => {
    beforeEach(() => {
        ProjectHelper.getProjectById.mockReset()
        ProjectHelper.getProjectById.mockReturnValue(undefined)
    })

    it('getEstimationResume falls back to the time estimation type', () => {
        expect(getEstimationResume('missingProjectId', 120)).toEqual({ value: 2, text: 'Hours', hours: 2 })
    })

    it('generateDateHeaderText renders the header instead of crashing', () => {
        const text = generateDateHeaderText('missingProjectId', '13/08/2026', 'THURSDAY', 120, 3)
        expect(text).toBe('13/08/2026 • THURSDAY • 2 HOURS • 3 TASKS')
    })

    it('generateDateHeaderTextInMyDaySection treats the estimation as time instead of crashing', () => {
        const text = generateDateHeaderTextInMyDaySection('20260812', ['missingProjectId'], [120], 2)
        expect(text).toBe('12/08/2026 • WEDNESDAY • 2 HOURS • 2 TASKS')
    })

    it('still uses the project estimation type when the project exists', () => {
        ProjectHelper.getProjectById.mockReturnValue({ estimationType: ESTIMATION_TYPE_POINTS })
        expect(getEstimationResume('existingProjectId', 60)).toEqual({ value: 60, text: 'Points', hours: 0 })
    })
})
