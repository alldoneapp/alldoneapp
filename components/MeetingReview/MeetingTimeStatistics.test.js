import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockProjects = [
    { id: 'p1', name: 'Alldone Product', color: '#0070E0' },
    { id: 'p2', name: 'Juno', color: '#07A873' },
]
jest.mock('react-redux', () => ({
    useSelector: selector =>
        selector({ loggedUser: { uid: 'me' }, smallScreenNavigation: false, loggedUserProjects: mockProjects }),
}))
jest.mock('../SettingsView/SettingsHelper', () => ({
    __esModule: true,
    default: { processURLSettingsTab: jest.fn() },
}))
jest.mock('../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
}))
jest.mock('../../URLSystem/Settings/URLsSettings', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_SETTINGS_MEETING_TIME: 'SETTINGS_MEETING_TIME',
}))
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))
jest.mock('../../utils/meetingReview/meetingReviewBackend', () => ({
    fetchMeetingStatsTasks: jest.fn(),
    fetchMeetingReviewsInRange: jest.fn(),
    fetchWorkingHoursSettings: jest.fn(),
    getMeetingReviewDocId: id => id,
    deleteMeetingCategoryRule: jest.fn(() => Promise.resolve()),
    watchMeetingReviewsInRange: jest.fn(() => () => {}),
    watchMeetingSeriesCategories: jest.fn(() => () => {}),
    watchMeetingCategoryRules: jest.fn(() => () => {}),
}))

import moment from 'moment'
import MeetingTimeStatistics from './MeetingTimeStatistics'
import {
    fetchMeetingReviewsInRange,
    fetchMeetingStatsTasks,
    fetchWorkingHoursSettings,
} from '../../utils/meetingReview/meetingReviewBackend'
import SettingsHelper from '../SettingsView/SettingsHelper'
import URLsSettings from '../../URLSystem/Settings/URLsSettings'
import { getMeetingReviewState, resetMeetingReviewStoreForTests } from '../../utils/meetingReview/meetingReviewStore'

// Monday of the current local week, so the default week view covers these appointments.
const monday = moment().startOf('isoWeek')
const at = (h, m = 0) => monday.clone().hour(h).minute(m).valueOf()
const calendarTask = (id, start, end, extra = {}) => ({
    id,
    projectId: 'p1',
    name: id,
    done: true,
    calendarData: { startMs: start, endMs: end, attendeeCount: 3 },
    ...extra,
})

const flush = async () => {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
    })
}

// Unmounted after each test: a still-mounted tree would re-render when the next test resets the
// review store.
const mounted = []
const render = async (props = {}) => {
    let tree
    await act(async () => {
        tree = renderer.create(<MeetingTimeStatistics {...props} />)
    })
    mounted.push(tree)
    await flush()
    return {
        tree,
        byId: id => tree.root.findByProps({ testID: id }),
        // a composite and the elements it renders all carry the testID; only presence matters
        all: id => (tree.root.findAllByProps({ testID: id }).length > 0 ? [id] : []),
        text: id => [].concat(tree.root.findByProps({ testID: id }).props.children).join(''),
    }
}

afterEach(() => {
    mounted.splice(0).forEach(tree => act(() => tree.unmount()))
})

beforeEach(() => {
    jest.clearAllMocks()
    resetMeetingReviewStoreForTests()
    fetchWorkingHoursSettings.mockResolvedValue({ workingHoursStart: '09:00', workingHoursEnd: '18:00' })
})

describe('MeetingTimeStatistics', () => {
    it('shows the denominator, unrated time and the matrix; a cell opens the drill-down', async () => {
        fetchMeetingStatsTasks.mockResolvedValue({
            tasks: [
                calendarTask('standup', at(9), at(9, 30)),
                calendarTask('customer', at(10), at(11)),
                calendarTask('holiday', at(0), at(23, 59), {
                    calendarData: { start: { date: '2026-11-23' }, end: { date: '2026-11-24' } },
                }),
            ],
            failedProjectIds: [],
        })
        fetchMeetingReviewsInRange.mockResolvedValue({
            standup: {
                reviewStatus: 'rated',
                usefulness: 'not_helpful',
                category: 'status',
                categorySource: 'user',
                startMs: at(9),
            },
        })

        const { byId, text, all } = await render()
        expect(text('meeting-stats-summary')).toContain('"total":"1 h 30"')
        expect(text('meeting-stats-summary')).toContain('"count":2')
        expect(text('meeting-stats-summary')).toContain('"rated":33')
        expect(all('meeting-stats-limited')).toHaveLength(1)
        expect(text('meeting-stats-not-helpful')).toContain('"min":"0 h 30","max":"0 h 30"')

        // the unrated customer call has no confirmed category: it is in "category open", not invented
        act(() => byId('meeting-stats-cell-open-unrated').props.onPress())
        expect(all('meeting-stats-row-customer')).toHaveLength(1)
        expect(all('meeting-stats-row-standup')).toHaveLength(0)
        expect(all('meeting-stats-row-holiday')).toHaveLength(0)
    })

    it('opens the sheet in edit mode from a drill-down row', async () => {
        fetchMeetingStatsTasks.mockResolvedValue({ tasks: [calendarTask('a', at(9), at(10))], failedProjectIds: [] })
        fetchMeetingReviewsInRange.mockResolvedValue({})
        const { byId } = await render()
        act(() => byId('meeting-stats-segment-unrated').props.onPress())
        act(() => byId('meeting-stats-row-a').props.onPress())
        expect(getMeetingReviewState().queue[0]).toMatchObject({ isEdit: true, projectId: 'p1' })
    })

    it('says so when projects could not be read instead of showing a smaller total as complete', async () => {
        fetchMeetingStatsTasks.mockResolvedValue({ tasks: [], failedProjectIds: ['p2'] })
        fetchMeetingReviewsInRange.mockResolvedValue({})
        const { all } = await render()
        expect(all('meeting-stats-incomplete')).toHaveLength(1)
        expect(all('meeting-stats-empty')).toHaveLength(1)
    })

    it('fails honestly offline (no zero values)', async () => {
        const error = new Error('offline')
        error.code = 'offline'
        fetchMeetingStatsTasks.mockRejectedValue(error)
        fetchMeetingReviewsInRange.mockResolvedValue({})
        const { text, all } = await render()
        expect(text('meeting-stats-error')).toBe('Meeting statistics offline')
        expect(all('meeting-stats-summary')).toHaveLength(0)
    })

    describe('projects and working hours (AT-3145)', () => {
        // p1 9–10 worthwhile, p2 9:30–10:30 unrated: 30 shared minutes split between them.
        const twoProjects = () => {
            fetchMeetingStatsTasks.mockResolvedValue({
                tasks: [
                    calendarTask('alldone', at(9), at(10)),
                    calendarTask('juno', at(9, 30), at(10, 30), { projectId: 'p2' }),
                ],
                failedProjectIds: [],
            })
            fetchMeetingReviewsInRange.mockResolvedValue({
                alldone: {
                    reviewStatus: 'rated',
                    usefulness: 'worthwhile',
                    category: 'work',
                    categorySource: 'user',
                    startMs: at(9),
                },
            })
        }

        it('breaks the time down by project; a project row narrows the whole view to it', async () => {
            twoProjects()
            const { byId, text, all } = await render()
            expect(all('meeting-stats-projects')).toHaveLength(1)
            expect(text('meeting-stats-summary')).toContain('"total":"1 h 30"')
            expect(all('meeting-stats-project-filter')).toHaveLength(0)

            act(() => byId('meeting-stats-project-p1').props.onPress())
            expect(text('meeting-stats-summary')).toContain('"total":"0 h 45"')
            expect(text('meeting-stats-summary')).toContain('"rated":100')
            expect(
                byId('meeting-stats-project-filter')
                    .findAllByType(require('react-native').Text)
                    .map(node => node.props.children)
            ).toEqual(['Meeting project filter {"name":"Alldone Product"}', 'Meeting show all projects'])
            // the table keeps listing every project while one is selected
            expect(all('meeting-stats-project-p2')).toHaveLength(1)
            expect(byId('meeting-stats-project-p1').props.accessibilityState).toEqual({ selected: true })

            act(() => byId('meeting-stats-project-filter-clear').props.onPress())
            expect(text('meeting-stats-summary')).toContain('"total":"1 h 30"')
        })

        it('in the project details shows only that project, without the project table or rules', async () => {
            twoProjects()
            const { text, all } = await render({ projectId: 'p2' })
            expect(text('meeting-stats-summary')).toContain('"total":"0 h 45"')
            expect(text('meeting-stats-summary')).toContain('"rated":0')
            expect(all('meeting-stats-projects')).toHaveLength(0)
            expect(all('meeting-stats-project-hint')).toHaveLength(1)
            // the project tab writes its own URL
            expect(URLsSettings.push).not.toHaveBeenCalled()
        })

        it('names the working hours and links to where they are edited', async () => {
            fetchMeetingStatsTasks.mockResolvedValue({ tasks: [], failedProjectIds: [] })
            fetchMeetingReviewsInRange.mockResolvedValue({})
            const { byId } = await render()
            const line = byId('meeting-stats-working-hours')
                .findAllByType(require('react-native').Text)
                .map(node => [].concat(node.props.children).join(''))
            expect(line[0]).toBe('Meeting working window {"range":"9–18"}')
            act(() => byId('meeting-stats-working-hours-link').props.onPress())
            expect(SettingsHelper.processURLSettingsTab).toHaveBeenCalledWith(
                expect.anything(),
                'SETTINGS_CUSTOMIZATIONS'
            )
        })

        it('labels assumed default hours and keeps the link when they cannot be read', async () => {
            fetchMeetingStatsTasks.mockResolvedValue({ tasks: [], failedProjectIds: [] })
            fetchMeetingReviewsInRange.mockResolvedValue({})
            fetchWorkingHoursSettings.mockResolvedValue(null)
            let view = await render()
            expect(
                view.byId('meeting-stats-working-hours').findAllByType(require('react-native').Text)[0].props.children
            ).toBe('Meeting working window default {"range":"9–17"}')

            fetchWorkingHoursSettings.mockRejectedValue(new Error('unavailable'))
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
            view = await render()
            expect(
                view.byId('meeting-stats-working-hours').findAllByType(require('react-native').Text)[0].props.children
            ).toBe('Meeting working window unknown')
            expect(view.all('meeting-stats-working-hours-link')).toHaveLength(1)
            warn.mockRestore()
        })
    })
})
