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

    it('renders nothing in the shell when there is no top inset (bottom is never painted)', () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} }
        getSafeAreaInsets.mockReturnValue({ top: 0, right: 0, bottom: 34, left: 0 })
        const tree = renderer.create(<ShellInsetPainter routeName={'Root'} />)
        expect(tree.toJSON()).toBeNull()
    })

    it('paints only a top strip, in the login gradient color, on login-like routes', () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} }
        getSafeAreaInsets.mockReturnValue({ top: 59, right: 0, bottom: 34, left: 0 })
        const tree = renderer.create(<ShellInsetPainter routeName={'LoginScreen'} />).toJSON()
        const strips = Array.isArray(tree) ? tree : [tree]
        expect(strips).toHaveLength(1)
        const flatten = style => Object.assign({}, ...[].concat(style).filter(Boolean))
        // react-native-web normalizes colors to rgba strings.
        expect(flatten(strips[0].props.style)).toMatchObject({
            height: '59px',
            backgroundColor: 'rgba(173,204,255,1.00)',
        })
    })

    it('paints the theme header color on app routes', () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} }
        getSafeAreaInsets.mockReturnValue({ top: 59, right: 0, bottom: 34, left: 0 })
        const tree = renderer.create(<ShellInsetPainter routeName={'Root'} />).toJSON()
        const strips = Array.isArray(tree) ? tree : [tree]
        expect(strips).toHaveLength(1)
        const flatten = style => Object.assign({}, ...[].concat(style).filter(Boolean))
        expect(typeof flatten(strips[0].props.style).backgroundColor).toBe('string')
    })
})
