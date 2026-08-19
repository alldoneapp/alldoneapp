import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useSelector: fn => fn({ loggedUser: { themeName: undefined } }),
}))
jest.mock('../../utils/safeAreaInsets', () => ({
    getSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}))
jest.mock('../../utils/useWindowSize', () => () => [1024, 768])

import { getSafeAreaInsets } from '../../utils/safeAreaInsets'
import ShellInsetPainter from './ShellInsetPainter'

describe('ShellInsetPainter', () => {
    afterEach(() => {
        delete window.Capacitor
    })

    it('renders nothing outside the Capacitor shell (web/PWA untouched)', () => {
        getSafeAreaInsets.mockReturnValue({ top: 59, right: 0, bottom: 34, left: 0 })
        const tree = renderer.create(<ShellInsetPainter routeName={'LoginScreen'} />)
        expect(tree.toJSON()).toBeNull()
    })

    it('renders nothing in the shell when there are no insets', () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} }
        getSafeAreaInsets.mockReturnValue({ top: 0, right: 0, bottom: 0, left: 0 })
        const tree = renderer.create(<ShellInsetPainter routeName={'Root'} />)
        expect(tree.toJSON()).toBeNull()
    })

    it('paints login gradient edge colors on login-like routes', () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} }
        getSafeAreaInsets.mockReturnValue({ top: 59, right: 0, bottom: 34, left: 0 })
        const tree = renderer.create(<ShellInsetPainter routeName={'LoginScreen'} />).toJSON()
        const strips = Array.isArray(tree) ? tree : [tree]
        expect(strips).toHaveLength(2)
        const flatten = style => Object.assign({}, ...[].concat(style).filter(Boolean))
        // react-native-web normalizes colors to rgba strings.
        expect(flatten(strips[0].props.style)).toMatchObject({
            height: '59px',
            backgroundColor: 'rgba(173,204,255,1.00)',
        })
        expect(flatten(strips[1].props.style)).toMatchObject({
            height: '34px',
            backgroundColor: 'rgba(235,245,255,1.00)',
        })
    })

    it('paints theme colors on app routes', () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} }
        getSafeAreaInsets.mockReturnValue({ top: 59, right: 0, bottom: 34, left: 0 })
        const tree = renderer.create(<ShellInsetPainter routeName={'Root'} />).toJSON()
        const strips = Array.isArray(tree) ? tree : [tree]
        expect(strips).toHaveLength(2)
        const flatten = style => Object.assign({}, ...[].concat(style).filter(Boolean))
        // Top strip must carry a real theme color; bottom is the content white.
        expect(typeof flatten(strips[0].props.style).backgroundColor).toBe('string')
        expect(flatten(strips[1].props.style)).toMatchObject({ backgroundColor: 'rgba(255,255,255,1.00)' })
    })
})
