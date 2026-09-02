/**
 * AT-2392 — Settings → Happiness is no longer read-only.
 *
 * Before this, the ONLY way to record a happiness rating was to be shown the
 * "new day" popup, which appears once a day and always rates the day that just
 * ended: a day missed (or a day you wanted to revisit) could never be rated at
 * all. The entry point is what this suite pins — the rating behaviour itself
 * lives in `__tests__/ProjectHappiness/`.
 */

import React from 'react'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'

jest.mock('../../utils/BackendBridge', () => ({
    watchProjectHappinessByRange: jest.fn(),
    setProjectHappiness: jest.fn(() => Promise.resolve()),
    getUserStatistics: jest.fn(),
    unwatch: jest.fn(),
}))

jest.mock('../../URLSystem/Settings/URLsSettings', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_SETTINGS_HAPPINESS: 'SETTINGS_HAPPINESS',
}))

jest.mock(
    '../../components/UIComponents/ModalShell/AppPopover',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../components/UIComponents/Calendar/AppCalendar', () => () => null)

import Button from '../../components/UIControls/Button'
import HappinessRatingModal from '../../components/ProjectHappiness/HappinessRatingModal'
import UserHappiness from '../../components/SettingsView/Happiness/UserHappiness'

const PROJECT = { id: 'project-a', name: 'Alldone Product', sortIndexByUser: { 'user-1': 1 } }

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
        statisticsData: { filter: 'Last 7 days', customDateRange: [] },
    },
    loggedUserProjects: [PROJECT],
    smallScreenNavigation: false,
    isMiddleScreen: false,
    smallScreen: false,
    showShortcuts: false,
    showFloatPopup: false,
}

const makeStore = (overrides = {}) => {
    const state = { ...storeState, ...overrides }
    return {
        getState: () => state,
        subscribe: () => () => {},
        dispatch: () => {},
    }
}

const render = (storeOverrides = {}) => {
    let tree
    renderer.act(() => {
        tree = renderer.create(
            <Provider store={makeStore(storeOverrides)}>
                <UserHappiness />
            </Provider>
        )
    })
    return tree
}

const flattenStyle = style => (Array.isArray(style) ? style : [style]).flat(Infinity).filter(Boolean)
const styleOf = (tree, testID) => Object.assign({}, ...flattenStyle(tree.root.findByProps({ testID }).props.style))

const findRateButton = tree => tree.root.findAllByType(Button).find(button => button.props.icon === 'smile')

describe('Settings → Happiness (AT-2392)', () => {
    beforeEach(() => jest.clearAllMocks())

    it('offers a way to rate happiness', () => {
        const tree = render()

        expect(findRateButton(tree)).toBeTruthy()
    })

    it('keeps the rating popup closed until the button is pressed', () => {
        const tree = render()

        expect(tree.root.findAllByType(HappinessRatingModal)).toHaveLength(0)

        renderer.act(() => findRateButton(tree).props.onPress())

        expect(tree.root.findAllByType(HappinessRatingModal)).toHaveLength(1)
    })

    it('closes the popup again when it asks to be closed', () => {
        const tree = render()

        renderer.act(() => findRateButton(tree).props.onPress())
        renderer.act(() => tree.root.findByType(HappinessRatingModal).props.onClose())

        expect(tree.root.findAllByType(HappinessRatingModal)).toHaveLength(0)
    })
})

describe('Settings → Happiness header on a phone', () => {
    it('keeps the title and the controls on one line on desktop', () => {
        const tree = render()

        expect(styleOf(tree, 'happinessHeader').flexDirection).toBe('row')
        expect(styleOf(tree, 'happinessHeaderActions').marginLeft).toBe('auto')
    })

    it('stacks the controls under the title and lets them wrap on a phone', () => {
        const tree = render({ smallScreenNavigation: true })

        expect(styleOf(tree, 'happinessHeader').flexDirection).toBe('column')
        const actions = styleOf(tree, 'happinessHeaderActions')
        expect(actions.flexWrap).toBe('wrap')
        expect(actions.marginLeft).toBe(0)
        // The button is still there — it moved, it did not disappear.
        expect(findRateButton(tree)).toBeTruthy()
    })
})
