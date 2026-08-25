import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({
    connect: () => component => component,
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            loggedUser: { themeName: 'default', isAnonymous: false, premium: { status: '' } },
            expandedNavPicker: false,
        }),
}))
jest.mock('./TopBarMobileStatisticArea', () => 'TopBarMobileStatisticArea')
jest.mock('./MobileNotificationArea', () => 'MobileNotificationArea')
jest.mock('../ConnectionStatusChip', () => 'ConnectionStatusChip')
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
    it('does not pin the connection status chip inside the mobile header', () => {
        const component = renderer.create(<TopBarMobile />)

        expect(component.root.findAllByType('ConnectionStatusChip')).toHaveLength(0)
    })
})
