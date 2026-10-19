import React from 'react'
import renderer from 'react-test-renderer'

let mockCompact = false
let mockExpanded = false

jest.mock('react-redux', () => ({
    connect: () => component => component,
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            loggedUser: { themeName: 'default', isAnonymous: false, premium: { status: '' } },
            expandedNavPicker: mockExpanded,
            reallySmallScreenNavigation: mockCompact,
        }),
}))
jest.mock('./TopBarMobileStatisticArea', () => 'TopBarMobileStatisticArea')
jest.mock('./MobileNotificationArea', () => 'MobileNotificationArea')
jest.mock('../ConnectionStatusChip', () => 'ConnectionStatusChip')
jest.mock('../AssistantModeButton', () => 'AssistantModeButton')
jest.mock('../GoldArea', () => 'GoldArea')
jest.mock('../QuotaBar/QuotaBar', () => ({
    __esModule: true,
    default: 'QuotaBar',
    QUOTA_BAR_MOBILE: 'mobile',
}))
jest.mock('../PremiumBar/PremiumBar', () => 'PremiumBar')
jest.mock('../TasksStatisticsArea', () => 'TasksStatisticsArea')
jest.mock('../../XpBar/XpBar', () => ({
    __esModule: true,
    default: 'XpBar',
    XP_BAR_MOBILE: 'mobile',
}))
jest.mock('../../Premium/PremiumHelper', () => ({ PLAN_STATUS_PREMIUM: 'premium' }))
jest.mock('../../../redux/actions', () => ({
    toggleNavPicker: value => ({ type: 'toggle nav picker', value }),
}))
jest.mock('../../../Themes/Themes', () => ({
    getTheme: () => ({ container: {}, itemsContainerMobile: {}, homeIcon: 'black' }),
}))
jest.mock('../Themes', () => ({ Themes: {} }))

import TopBarMobile from './TopBarMobile'

describe('TopBarMobile connection health', () => {
    beforeEach(() => {
        mockCompact = false
        mockExpanded = false
    })
    it('does not pin the connection status chip inside the mobile header', () => {
        const component = renderer.create(<TopBarMobile />)

        expect(component.root.findAllByType('ConnectionStatusChip')).toHaveLength(0)
    })

    it('includes the centered assistant-mode entry point in the top row', () => {
        const component = renderer.create(<TopBarMobile />)
        expect(component.root.findByProps({ testID: 'top-bar-mobile' }).findByType('AssistantModeButton')).toBeTruthy()
    })

    it('keeps the Gold balance accessible in expanded statistics on narrow phones', () => {
        mockCompact = true
        mockExpanded = true
        const component = renderer.create(<TopBarMobile />)
        expect(component.root.findByType('TopBarMobileStatisticArea').props.compact).toBe(true)
        expect(component.root.findByType('MobileNotificationArea').props.compact).toBe(true)
        expect(component.root.findAllByType('GoldArea')).toHaveLength(1)
        expect(component.root.findAllByType('XpBar')).toHaveLength(1)
        expect(component.root.findAllByType('TasksStatisticsArea')).toHaveLength(1)
        expect(component.root.findAllByType('QuotaBar')).toHaveLength(1)
    })
})
