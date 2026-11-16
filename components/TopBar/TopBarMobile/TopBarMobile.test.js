import React from 'react'
import renderer, { act } from 'react-test-renderer'

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
jest.mock('../HomeButton', () => ({ __esModule: true, default: 'HomeButton', HOME_BUTTON_WIDTH: 40 }))
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
    barWidth: { mobile: 92 },
}))
jest.mock('../../Premium/PremiumHelper', () => ({ PLAN_STATUS_PREMIUM: 'premium' }))
jest.mock('../../../redux/actions', () => ({
    toggleNavPicker: value => ({ type: 'toggle nav picker', value }),
}))
jest.mock('../../../Themes/Themes', () => ({
    getTheme: () => ({ container: {}, itemsContainerMobile: {}, homeIcon: 'black' }),
}))
jest.mock('../Themes', () => ({ Themes: {} }))
jest.mock('../../Anna/AnnaViewSwitch', () => {
    const React = require('react')
    return {
        __esModule: true,
        default: 'AnnaViewSwitch',
        AnnaViewSwitchContext: React.createContext(null),
        ANNA_VIEW_SWITCH_WIDTH: 76,
        ANNA_VIEW_SWITCH_HEIGHT: 38,
    }
})

import TopBarMobile, { getCenterLeft, getLeftAreaMaxWidth } from './TopBarMobile'
import { AnnaViewSwitchContext } from '../../Anna/AnnaViewSwitch'

describe('TopBarMobile connection health', () => {
    beforeEach(() => {
        mockCompact = false
        mockExpanded = false
    })
    it('does not pin the connection status chip inside the mobile header', () => {
        const component = renderer.create(<TopBarMobile />)

        expect(component.root.findAllByType('ConnectionStatusChip')).toHaveLength(0)
    })

    it('includes the centered Home button in the top row', () => {
        const component = renderer.create(<TopBarMobile />)
        expect(component.root.findByProps({ testID: 'top-bar-mobile' }).findByType('HomeButton')).toBeTruthy()
    })

    it('keeps Gold in the top row on narrow phones instead of the expanded statistics (AT-3044)', () => {
        mockCompact = true
        mockExpanded = true
        const component = renderer.create(<TopBarMobile />)
        expect(
            component.root.findByProps({ testID: 'top-bar-mobile' }).findByType('TopBarMobileStatisticArea')
        ).toBeTruthy()
        expect(component.root.findByType('MobileNotificationArea').props.compact).toBe(true)
        // GoldArea is rendered by TopBarMobileStatisticArea (mocked here), not duplicated in the row.
        expect(
            component.root.findByProps({ testID: 'top-bar-mobile-statistics' }).findAllByType('GoldArea')
        ).toHaveLength(0)
        expect(component.root.findAllByType('XpBar')).toHaveLength(1)
        expect(component.root.findAllByType('TasksStatisticsArea')).toHaveLength(1)
        expect(component.root.findAllByType('QuotaBar')).toHaveLength(1)
    })

    it('caps the left area so Gold never reaches the centred Home button', () => {
        const component = renderer.create(<TopBarMobile />)
        const leftArea = () => component.root.findByProps({ testID: 'top-bar-mobile-left' })
        const maxWidthOf = node => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)).maxWidth

        expect(maxWidthOf(leftArea())).toBeUndefined()
        act(() =>
            component.root
                .findByProps({ testID: 'top-bar-mobile' })
                .props.onLayout({ nativeEvent: { layout: { width: 360 } } })
        )
        // 360 / 2 - 40 / 2 (Home) - 16 (padding) - 8 (gap)
        expect(maxWidthOf(leftArea())).toBe(136)
    })

    it.each([
        [0, undefined],
        [320, 116],
        [432, 172],
        [40, 0],
    ])('getLeftAreaMaxWidth(%s) is %s', (width, expected) => {
        expect(getLeftAreaMaxWidth(width)).toBe(expected)
    })

    // Inside AnnaShell on a phone the Anna | App switch takes the Home button's place.
    describe('with the assistant switch', () => {
        const onSelect = jest.fn()
        const viewSwitch = { layout: 'alldone', assistantName: 'Anna', photo: '', openTasksAmount: 3, onSelect }
        const render = () =>
            renderer.create(
                <AnnaViewSwitchContext.Provider value={viewSwitch}>
                    <TopBarMobile />
                </AnnaViewSwitchContext.Provider>
            )
        const layout = (component, testID, width) =>
            act(() => component.root.findByProps({ testID }).props.onLayout({ nativeEvent: { layout: { width } } }))
        const leftOf = node => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)).left

        it('shows the switch, icons only, instead of the Home button', () => {
            const component = render()
            expect(component.root.findAllByType('HomeButton')).toHaveLength(0)
            const switchNode = component.root.findByType('AnnaViewSwitch')
            expect(switchNode.props).toEqual(expect.objectContaining({ layout: 'alldone', iconsOnly: true }))
            act(() => switchNode.props.onSelect('chat'))
            expect(onSelect).toHaveBeenCalledWith('chat')
        })

        it('stays centred where there is room, and moves left of the right-hand buttons on a narrow phone', () => {
            const component = render()
            layout(component, 'top-bar-mobile', 375)
            layout(component, 'top-bar-mobile-right', 124)
            // 375 / 2 - 76 / 2: centred, 9px clear of the buttons that start at 375 - 16 - 124.
            expect(leftOf(component.root.findByProps({ testID: 'top-bar-mobile-view-switch' }))).toBe(149.5)
            layout(component, 'top-bar-mobile', 320)
            // 320 - 16 - 124 - 8 - 76: 8px clear of them; the left group shrinks to make room.
            expect(leftOf(component.root.findByProps({ testID: 'top-bar-mobile-view-switch' }))).toBe(96)
            const leftArea = component.root.findByProps({ testID: 'top-bar-mobile-left' })
            expect(Object.assign({}, ...[leftArea.props.style].flat(Infinity).filter(Boolean)).maxWidth).toBe(72)
        })
    })

    it('getCenterLeft keeps the Home button centred unless the right-hand buttons need the room', () => {
        expect(getCenterLeft(375, 40, 124)).toBe(167.5)
        expect(getCenterLeft(300, 40, 124)).toBe(112)
    })
})
