import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

// Renders the real PremiumBar and QuotaBar through TopBarStatisticArea, the one place that picks
// between them, in every viewport/variant that reaches it: wide desktop, the small-screen flag
// (tablet/narrow window), and AnnaTopStrip's explicit `compact` (split pane beside the chat, which
// passes `compact={false}` when the strip has room even while the pane's own flag says small).
let mockState

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))
jest.mock('../XpBar/XpBar', () => ({ __esModule: true, default: 'XpBar', XP_BAR_TABLET: 'tablet' }))
jest.mock('./GoldArea', () => 'GoldArea')
jest.mock('./TasksStatisticsArea', () => 'TasksStatisticsArea')
jest.mock('./QuotaBar/Percent', () => 'Percent')
jest.mock('../Icon', () => 'Icon')
jest.mock('../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../utils/TabNavigationConstants', () => ({ DV_TAB_SETTINGS_PREMIUM: 'premium-tab' }))
jest.mock('../../redux/actions', () => ({ navigateToSettings: options => ({ type: 'settings', options }) }))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../Themes/Themes', () => ({
    getTheme: () => ({ desktop: { container: {}, text: {} }, mobile: { container: {}, text: {} } }),
}))
jest.mock('./Themes', () => ({ Themes: {} }))
jest.mock('../Premium/PremiumHelper', () => ({ PLAN_STATUS_PREMIUM: 'premium' }))

const TopBarStatisticArea = require('./TopBarStatisticArea').default

const render = props => {
    let component
    act(() => {
        component = renderer.create(<TopBarStatisticArea {...props} />, {
            createNodeMock: () => ({ setAttribute: jest.fn() }),
        })
    })
    return component
}
const texts = component => component.root.findAllByType(Text).map(node => node.props.children)

// [variant, smallScreen flag, props]
const VARIANTS = [
    ['wide desktop top bar', false, {}],
    ['tablet / narrow window top bar (small-screen flag)', true, {}],
    ['Anna strip with room', false, { compact: false }],
    ['Anna strip with room while the pane beside the chat is small', true, { compact: false }],
    ['Anna strip short of room', false, { compact: true }],
    ['Anna strip short of room on a small pane', true, { compact: true }],
    ['Anna strip without XP and done-task count', false, { compact: false, showXp: false, showTasksStatistics: false }],
]

describe('TopBarStatisticArea paid-user badge', () => {
    describe.each(VARIANTS)('%s', (_variant, smallScreen, props) => {
        it('shows the crown alone for a paid user, never the "Premium" label', () => {
            mockState = { smallScreen, loggedUser: { themeName: 'default', premium: { status: 'premium' } } }
            const component = render(props)

            expect(texts(component)).not.toContain('Premium')
            expect(component.root.findAllByType(Text)).toHaveLength(0)
            const badge = component.root.findByProps({ testID: 'premium-bar' })
            expect(badge.findByType('Icon').props.name).toBe('crown')
            expect(badge.props.accessibilityLabel).toBe('Premium')
        })

        it('leaves the free user upgrade prompt as it was', () => {
            mockState = { smallScreen, loggedUser: { themeName: 'default', premium: { status: 'free' } } }
            const component = render(props)
            const iconOnly = props.compact ?? smallScreen

            expect(component.root.findAllByProps({ testID: 'premium-bar' })).toHaveLength(0)
            expect(component.root.findAllByType('Percent')).toHaveLength(1)
            expect(texts(component)).toEqual(iconOnly ? [] : ['Free quota'])
            expect(component.root.findAllByType('Icon').map(icon => icon.props.name)).toEqual(iconOnly ? ['cap'] : [])
        })
    })
})
