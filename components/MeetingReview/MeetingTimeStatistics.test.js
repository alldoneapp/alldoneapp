import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockProjects = [
    { id: 'p1', name: 'Alldone Product', color: '#0070E0' },
    { id: 'p2', name: 'Juno', color: '#07A873' },
]
const mockLoggedUser = { uid: 'me' }
jest.mock('react-redux', () => ({
    useSelector: selector =>
        selector({ loggedUser: mockLoggedUser, smallScreenNavigation: false, loggedUserProjects: mockProjects }),
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
    delete mockLoggedUser.apisConnected
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

    describe('meeting-free work time per day (AT-3145)', () => {
        // The previous week is complete whenever the test runs, so every workday counts.
        const prevMonday = monday.clone().subtract(1, 'week')
        const prevAt = (days, h, m = 0) => prevMonday.clone().add(days, 'days').hour(h).minute(m).valueOf()
        const rowTexts = (byId, dayOffset) =>
            byId(`meeting-free-row-${prevMonday.clone().add(dayOffset, 'days').valueOf()}`)
                .findAllByType(require('react-native').Text)
                .map(node => [].concat(node.props.children).join(''))
        const lastWeek = async (props = {}) => {
            fetchMeetingStatsTasks.mockResolvedValue({
                tasks: [
                    calendarTask('alldone', prevAt(0, 9), prevAt(0, 10)),
                    calendarTask('juno', prevAt(0, 9, 30), prevAt(0, 10, 30), { projectId: 'p2' }),
                    calendarTask('focus', prevAt(1, 13), prevAt(1, 15), {
                        calendarData: {
                            startMs: prevAt(1, 13),
                            endMs: prevAt(1, 15),
                            soloEvent: true,
                            workBlock: true,
                        },
                    }),
                ],
                failedProjectIds: [],
            })
            fetchMeetingReviewsInRange.mockResolvedValue({})
            const view = await render(props)
            await act(async () => view.byId('meeting-stats-prev').props.onPress())
            await flush()
            return view
        }

        it('needs a connected calendar instead of showing an empty calendar as free time', async () => {
            const { all } = await lastWeek()
            expect(all('meeting-free-no-calendar')).toHaveLength(1)
            expect(all('meeting-free-summary')).toHaveLength(0)
            expect(all('meeting-free-table')).toHaveLength(0)
        })

        it('shows window, union of meetings and meeting-free time per day, flags days without entries', async () => {
            mockLoggedUser.apisConnected = { p1: { calendar: true } }
            const { text, all, byId } = await lastWeek()
            // Mon 9–18 minus 9:00–10:30 (overlap counted once) = 7 h 30; Tue–Fri have no meeting.
            expect(text('meeting-free-summary')).toBe(
                'Meeting free summary {"average":"8 h 42","free":"43 h 30","window":"45 h 00","share":97,"days":5,"meetings":"1 h 30"}'
            )
            expect(rowTexts(byId, 0).slice(1, 4)).toEqual(['9 h 00', '1 h 30', '7 h 30'])
            // the solo work block on Tuesday is work time, and Tuesday has a calendar entry
            expect(rowTexts(byId, 1).slice(1, 4)).toEqual(['9 h 00', '0 h 00', '9 h 00'])
            expect(rowTexts(byId, 1)[4]).toBe('Meeting free solo blocks {"count":1}')
            expect(rowTexts(byId, 2)[4]).toBe('Meeting free note no entries')
            expect(text('meeting-free-no-entries')).toBe('Meeting free no entries hint {"count":3}')
            // weekends are no workdays without "Include weekends"
            expect(rowTexts(byId, 5).slice(1, 5)).toEqual(['–', '–', '–', 'Meeting free non workday'])
            expect(text('meeting-free-current-settings')).toContain('"range":"9–18"')
            expect(all('meeting-free-scope-hint')).toHaveLength(0)
        })

        it('keeps the free time global under a project filter and only highlights the project part', async () => {
            mockLoggedUser.apisConnected = { p1: { calendar: true } }
            const { text, all, byId } = await lastWeek()
            act(() => byId('meeting-stats-project-p1').props.onPress())
            expect(all('meeting-free-scope-hint')).toHaveLength(1)
            expect(text('meeting-free-summary')).toContain('"free":"43 h 30"')
            expect(text('meeting-free-summary')).toContain(
                'Meeting free scoped part {"name":"Alldone Product","time":"1 h 00"}'
            )
        })

        it('in the project details also subtracts the other projects’ meetings', async () => {
            mockLoggedUser.apisConnected = { p1: { calendar: true } }
            const { text } = await lastWeek({ projectId: 'p2' })
            expect(text('meeting-free-summary')).toContain('"free":"43 h 30"')
            expect(text('meeting-free-summary')).toContain('Meeting free scoped part {"name":"Juno","time":"1 h 00"}')
        })

        it('uses "Include weekends" from the working hours settings', async () => {
            mockLoggedUser.apisConnected = { p1: { calendar: true } }
            fetchWorkingHoursSettings.mockResolvedValue({
                workingHoursStart: '09:00',
                workingHoursEnd: '18:00',
                includeWeekends: true,
            })
            const { text } = await lastWeek()
            expect(text('meeting-free-summary')).toContain('"days":7')
            expect(text('meeting-free-current-settings')).toContain('Meeting free all days')
        })
    })
})
