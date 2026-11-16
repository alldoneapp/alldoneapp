import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet, Text } from 'react-native'

const mockDispatch = jest.fn()
const mockNavigate = jest.fn()
let mockState

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../../utils/NavigationService', () => ({ navigate: (...args) => mockNavigate(...args) }))
jest.mock('../../../utils/TabNavigationConstants', () => ({ DV_TAB_SETTINGS_PREMIUM: 'premium-tab' }))
jest.mock('../../../redux/actions', () => ({
    navigateToSettings: options => ({ type: 'navigate to settings', options }),
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => `t:${text}` }))
jest.mock('../../../Themes/Themes', () => ({
    getTheme: () => ({
        desktop: { container: { backgroundColor: 'surface' }, text: {} },
        mobile: { container: { backgroundColor: 'primary' }, text: {} },
        iconColor: 'desktop-icon',
        iconColorMobile: 'mobile-icon',
    }),
}))
jest.mock('../Themes', () => ({ Themes: {} }))

const PremiumBar = require('./PremiumBar').default
const { QUOTA_BAR_MOBILE, PREMIUM_BAR_DESKTOP_WIDTH } = require('./PremiumBar')

const render = props => {
    let component
    act(() => {
        component = renderer.create(<PremiumBar {...props} />, {
            createNodeMock: () => ({ setAttribute: mockSetAttribute }),
        })
    })
    return component
}
const mockSetAttribute = jest.fn()
const button = component => component.root.findByProps({ testID: 'premium-bar' })
const flatStyle = component => StyleSheet.flatten(button(component).props.style)

describe('PremiumBar (paid user header badge)', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        mockNavigate.mockClear()
        mockSetAttribute.mockClear()
        mockState = { smallScreen: false, loggedUser: { themeName: 'default' } }
    })

    it('shows only the crown on desktop, without the "Premium" label', () => {
        const component = render()

        expect(component.root.findAllByType(Text)).toHaveLength(0)
        const icons = component.root.findAllByType('Icon')
        expect(icons).toHaveLength(1)
        expect(icons[0].props).toEqual(expect.objectContaining({ name: 'crown', size: 20, color: 'desktop-icon' }))
    })

    it('is a compact fixed-size pill that keeps a full hit target and the theme surface', () => {
        const style = flatStyle(render())

        expect(style.width).toBe(PREMIUM_BAR_DESKTOP_WIDTH)
        expect(style.height).toBe(28)
        expect(style.paddingHorizontal).toBeUndefined()
        expect(style.justifyContent).toBe('center')
        expect(style.backgroundColor).toBe('surface')
    })

    it('keeps the accessible name and the hover tooltip', () => {
        const component = render()

        expect(button(component).props.accessibilityRole).toBe('button')
        expect(button(component).props.accessibilityLabel).toBe('t:Premium')
        expect(mockSetAttribute).toHaveBeenCalledWith('title', 't:Premium')
    })

    it('still opens Settings > Premium on press', () => {
        const component = render()

        act(() => button(component).props.onPress())

        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'navigate to settings',
            options: { selectedNavItem: 'premium-tab' },
        })
        expect(mockNavigate).toHaveBeenCalledWith('SettingsView')
    })

    it('narrows only the gap on small screens, and an explicit compact overrides the flag', () => {
        expect(flatStyle(render()).marginRight).toBe(16)

        mockState.smallScreen = true
        expect(flatStyle(render()).marginRight).toBe(8)
        // AnnaTopStrip passes compact from its own room; the pane's flag must not shrink it.
        expect(flatStyle(render({ compact: false })).marginRight).toBe(16)
        expect(flatStyle(render({ compact: true })).marginRight).toBe(8)
        expect(flatStyle(render({ compact: true })).width).toBe(PREMIUM_BAR_DESKTOP_WIDTH)
    })

    it('keeps the mobile crown-only badge with its mobile colors', () => {
        const component = render({ size: QUOTA_BAR_MOBILE })
        const style = flatStyle(component)

        expect(component.root.findAllByType(Text)).toHaveLength(0)
        expect(component.root.findByType('Icon').props.color).toBe('mobile-icon')
        expect(style.backgroundColor).toBe('primary')
        expect(style.paddingHorizontal).toBe(8)
        expect(style.marginRight).toBe(8)
        expect(button(component).props.accessibilityLabel).toBe('t:Premium')
    })
})
