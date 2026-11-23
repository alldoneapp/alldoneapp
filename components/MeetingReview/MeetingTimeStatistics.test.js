import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: 'me' }, smallScreenNavigation: false }),
}))
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
    getMeetingReviewDocId: id => id,
    deleteMeetingCategoryRule: jest.fn(() => Promise.resolve()),
    watchMeetingReviewsInRange: jest.fn(() => () => {}),
    watchMeetingSeriesCategories: jest.fn(() => () => {}),
    watchMeetingCategoryRules: jest.fn(() => () => {}),
}))

import moment from 'moment'
import MeetingTimeStatistics from './MeetingTimeStatistics'
import { fetchMeetingReviewsInRange, fetchMeetingStatsTasks } from '../../utils/meetingReview/meetingReviewBackend'
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

const render = async () => {
    let tree
    await act(async () => {
        tree = renderer.create(<MeetingTimeStatistics />)
    })
    await flush()
    return {
        tree,
        byId: id => tree.root.findByProps({ testID: id }),
        // a composite and the elements it renders all carry the testID; only presence matters
        all: id => (tree.root.findAllByProps({ testID: id }).length > 0 ? [id] : []),
        text: id => [].concat(tree.root.findByProps({ testID: id }).props.children).join(''),
    }
}

beforeEach(() => {
    jest.clearAllMocks()
    resetMeetingReviewStoreForTests()
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
})
