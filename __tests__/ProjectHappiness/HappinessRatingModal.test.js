/**
 * AT-2392 — "Rate happiness" in Settings → Happiness.
 *
 * The popup is the on-demand twin of the "new day" popup: same rows, same
 * write path, plus a date picker. What is worth pinning here is everything the
 * new-day popup could never do, because it only ever rated the day that had
 * just ended:
 *
 *   - the rating lands on the DAY THE USER PICKED, not on today;
 *   - a future day can never be rated, even if the calendar hands one over;
 *   - closing (Done / ×) cannot lose a comment that was never blurred.
 */

import React from 'react'
import { Text } from 'react-native'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'
import moment from 'moment'

jest.mock('../../utils/BackendBridge', () => ({
    setProjectHappiness: jest.fn(() => Promise.resolve()),
    watchProjectHappinessByRange: jest.fn(),
    getUserStatistics: jest.fn(),
    unwatch: jest.fn(),
}))

// The popover portals into document.body and the calendar grid is a heavy
// third-party render; neither is what this suite is about. Rendering the
// popover content inline keeps the date picker reachable as a plain prop.
jest.mock('../../components/UIComponents/ModalShell/AppPopover', () => ({ children, content }) => (
    <>
        {children}
        {content}
    </>
))
jest.mock('../../components/UIComponents/Calendar/AppCalendar', () => () => null)

import Backend from '../../utils/BackendBridge'
import HappinessRatingModal, {
    getTodayHappinessDate,
    isRatableHappinessDate,
} from '../../components/ProjectHappiness/HappinessRatingModal'
import HappinessRatingPicker from '../../components/ProjectHappiness/HappinessRatingPicker'

const PROJECT = { id: 'project-a', name: 'Alldone Product', sortIndexByUser: { 'user-1': 1 } }
const PROJECT_B = { id: 'project-b', name: 'Juno', sortIndexByUser: { 'user-1': 2 } }

const storeState = {
    loggedUser: {
        uid: 'user-1',
        isAnonymous: false,
        language: 'en',
        mondayFirstInCalendar: true,
        projectIds: [PROJECT.id],
        templateProjectIds: [],
        archivedProjectIds: [],
        guideProjectIds: [],
    },
    loggedUserProjects: [PROJECT],
    smallScreenNavigation: false,
    isMiddleScreen: false,
    smallScreen: false,
}

// A project is only ratable when it is in the user's project list too.
const TWO_PROJECTS = {
    loggedUser: { ...storeState.loggedUser, projectIds: [PROJECT.id, PROJECT_B.id] },
    loggedUserProjects: [PROJECT, PROJECT_B],
}

const makeStore = (overrides = {}) => {
    const state = { ...storeState, ...overrides }
    return {
        getState: () => state,
        subscribe: () => () => {},
        dispatch: () => {},
    }
}

const render = (onClose = jest.fn(), storeOverrides = {}) => {
    let tree
    renderer.act(() => {
        tree = renderer.create(
            <Provider store={makeStore(storeOverrides)}>
                <HappinessRatingModal onClose={onClose} />
            </Provider>
        )
    })
    return { tree, onClose }
}

const flatText = node =>
    (Array.isArray(node) ? node : [node])
        .map(child => (child == null || typeof child === 'boolean' ? '' : String(child)))
        .join('')

const textOf = instance =>
    instance
        .findAllByType(Text)
        .map(text => flatText(text.props.children))
        .join(' ')

const hasTestID = (tree, testID) => tree.root.findAllByProps({ testID }).length > 0

// A per-day watcher answers for the watched day; the month watcher (rated-day
// dots) is keyed separately. `entriesByKey` maps a watcher key to what it
// should deliver — anything unlisted stays silent, as an empty day would.
const answerWatchers = entriesByKey => {
    Backend.watchProjectHappinessByRange.mockImplementation(
        (projectId, userId, timestamp1, timestamp2, watcherKey, callback) => {
            if (entriesByKey[watcherKey]) callback(projectId, entriesByKey[watcherKey])
        }
    )
}

const answerStatistics = doneTasksByProject => {
    Backend.getUserStatistics.mockImplementation((projectId, userId, dateKey, callback) => {
        callback(projectId, { doneTasks: doneTasksByProject[projectId] })
    })
}

const press = (tree, testID) =>
    renderer.act(() => {
        tree.root.findByProps({ testID }).props.onPress()
    })

const rate = (tree, rating) =>
    renderer.act(() => {
        tree.root.findByType(HappinessRatingPicker).props.onChange(rating)
    })

// The calendar hands its host a `{ dateString }` day object.
const pickDay = (tree, dateString) =>
    renderer.act(() => {
        tree.root.findByProps({ markingType: 'custom' }).props.onDayPress({ dateString })
    })

describe('HappinessRatingModal (AT-2392)', () => {
    beforeEach(() => jest.clearAllMocks())

    it('offers today by default', () => {
        const { tree } = render()

        expect(tree.root.findByProps({ testID: 'happinessRatingDateButton' })).toBeTruthy()
        const [, , date] = Backend.watchProjectHappinessByRange.mock.calls[0]
        expect(date).toBe(moment().startOf('day').valueOf())
    })

    it('stores a rating for today on the tap', () => {
        const { tree } = render()

        rate(tree, 4)

        expect(Backend.setProjectHappiness).toHaveBeenCalledTimes(1)
        const [projectId, userId, date, rating] = Backend.setProjectHappiness.mock.calls[0]
        expect([projectId, userId, rating]).toEqual(['project-a', 'user-1', 4])
        expect(date).toBe(getTodayHappinessDate())
    })

    it('stores the rating against the day the user picked', () => {
        const { tree } = render()
        const lastWeek = moment().subtract(7, 'days').startOf('day')

        pickDay(tree, lastWeek.format('YYYY-MM-DD'))
        rate(tree, 2)

        const [, , date, rating] = Backend.setProjectHappiness.mock.calls[0]
        expect(date).toBe(lastWeek.valueOf())
        expect(rating).toBe(2)
    })

    it('re-reads the picked day rather than showing the previous one', () => {
        const { tree } = render()
        const lastWeek = moment().subtract(7, 'days').startOf('day')

        pickDay(tree, lastWeek.format('YYYY-MM-DD'))

        const watchedDays = Backend.watchProjectHappinessByRange.mock.calls.map(call => call[2])
        expect(watchedDays).toContain(lastWeek.valueOf())
    })

    it('refuses a future day even if the calendar offers one', () => {
        const { tree } = render()
        const tomorrow = moment().add(1, 'day').startOf('day')

        pickDay(tree, tomorrow.format('YYYY-MM-DD'))
        rate(tree, 5)

        const [, , date] = Backend.setProjectHappiness.mock.calls[0]
        expect(date).toBe(getTodayHappinessDate())
    })

    it('closes on Done, saving a comment that was never blurred', () => {
        const { tree, onClose } = render()

        rate(tree, 3)
        renderer.act(() => {
            tree.root.findByProps({ testID: 'happinessCommentButton_project-a' }).props.onPress()
        })
        renderer.act(() => {
            tree.root.findByProps({ testID: 'happinessComment_project-a' }).props.onChangeText('good day')
        })

        press(tree, 'doneHappinessRating')

        expect(onClose).toHaveBeenCalledTimes(1)
        const lastWrite = Backend.setProjectHappiness.mock.calls.pop()
        expect(lastWrite[3]).toBe(3)
        expect(lastWrite[4]).toBe('good day')
    })

    it('closes on the × too', () => {
        const { tree, onClose } = render()

        press(tree, 'closeHappinessRating')

        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('detaches its watchers on unmount', () => {
        const { tree } = render()

        renderer.act(() => tree.unmount())

        expect(Backend.unwatch).toHaveBeenCalledWith('settings_happiness_rating_user-1_project-a')
    })
})

describe('HappinessRatingModal — what the day already holds', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        Backend.watchProjectHappinessByRange.mockReset()
        Backend.getUserStatistics.mockReset()
    })

    it("shows the day's tasks done per project, read from the same statistics as the new-day popup", () => {
        answerStatistics({ 'project-a': 3, 'project-b': 0 })

        const { tree } = render(jest.fn(), TWO_PROJECTS)

        const today = moment().format('DDMMYYYY')
        expect(Backend.getUserStatistics).toHaveBeenCalledWith(
            'project-a',
            'user-1',
            today,
            expect.any(Function),
            expect.any(Function)
        )
        expect(Backend.getUserStatistics).toHaveBeenCalledWith(
            'project-b',
            'user-1',
            today,
            expect.any(Function),
            expect.any(Function)
        )
        expect(textOf(tree.root.findByProps({ testID: 'happinessDayActivity_project-a' }))).toContain('Tasks done: 3')
        expect(textOf(tree.root.findByProps({ testID: 'happinessDayActivity_project-b' }))).toContain('Tasks done: 0')
    })

    it('shows a dash, not a zero, while a count has not arrived', () => {
        const { tree } = render()

        expect(textOf(tree.root.findByProps({ testID: 'happinessDayActivity_project-a' }))).toContain('Tasks done: –')
    })

    it('re-reads the statistics for the day the user picked', () => {
        const { tree } = render()
        const lastWeek = moment().subtract(7, 'days').startOf('day')

        pickDay(tree, lastWeek.format('YYYY-MM-DD'))

        const readDays = Backend.getUserStatistics.mock.calls.map(call => call[2])
        expect(readDays).toContain(lastWeek.format('DDMMYYYY'))
    })

    it('says which projects are already rated for the day, and how many', () => {
        const today = getTodayHappinessDate()
        answerWatchers({
            'settings_happiness_rating_user-1_project-a': [{ rating: 4, comment: '', timestamp: today, updated: 1 }],
            'settings_happiness_rating_user-1_project-b': [],
        })

        const { tree } = render(jest.fn(), TWO_PROJECTS)

        expect(hasTestID(tree, 'happinessRated_project-a')).toBe(true)
        expect(hasTestID(tree, 'happinessNotRated_project-b')).toBe(true)
        expect(textOf(tree.root.findByProps({ testID: 'happinessRatedSummary' }))).toBe(
            '1 of 2 projects rated on this day'
        )
    })

    it('says so when nothing is rated for the day yet', () => {
        answerWatchers({ 'settings_happiness_rating_user-1_project-a': [] })

        const { tree } = render()

        expect(hasTestID(tree, 'happinessRated_project-a')).toBe(false)
        expect(hasTestID(tree, 'happinessNotRated_project-a')).toBe(true)
        expect(textOf(tree.root.findByProps({ testID: 'happinessRatedSummary' }))).toBe('No ratings for this day yet')
    })

    it('marks the already-rated days of the visible month in the date picker', () => {
        const ratedDay = moment().startOf('month').startOf('day')
        answerWatchers({
            'settings_happiness_rated_days_user-1_project-a': [{ rating: 5, timestamp: ratedDay.valueOf() }],
        })

        const { tree } = render()
        // The month watcher only runs while the picker is open.
        expect(Backend.watchProjectHappinessByRange.mock.calls.map(call => call[4])).not.toContain(
            'settings_happiness_rated_days_user-1_project-a'
        )

        press(tree, 'happinessRatingDateButton')

        const markedDates = tree.root.findByProps({ markingType: 'custom' }).props.markedDates
        expect(markedDates[ratedDay.format('YYYY-MM-DD')]).toMatchObject({ marked: true })
        // The selected day keeps its outline.
        expect(markedDates[moment().format('YYYY-MM-DD')]).toMatchObject({
            marked: true,
            customStyles: expect.any(Object),
        })
    })
})

describe('isRatableHappinessDate', () => {
    const now = new Date('2026-08-21T09:00:00.000Z').getTime()

    it('accepts today and the past', () => {
        expect(isRatableHappinessDate(new Date('2026-08-21T23:30:00.000Z').getTime(), now)).toBe(true)
        expect(isRatableHappinessDate(new Date('2026-08-20T00:00:00.000Z').getTime(), now)).toBe(true)
        expect(isRatableHappinessDate(new Date('2025-01-01T00:00:00.000Z').getTime(), now)).toBe(true)
    })

    it('rejects tomorrow and anything invalid', () => {
        expect(isRatableHappinessDate(new Date('2026-08-22T00:00:00.000Z').getTime(), now)).toBe(false)
        expect(isRatableHappinessDate(NaN, now)).toBe(false)
    })
})
