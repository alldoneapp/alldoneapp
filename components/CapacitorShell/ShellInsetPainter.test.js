import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

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
        cleanup()
        delete window.Capacitor
    })

    it('renders nothing outside the Capacitor shell (web/PWA untouched)', () => {
        getSafeAreaInsets.mockReturnValue({ top: 59, right: 0, bottom: 34, left: 0 })
        render(<ShellInsetPainter routeName={'LoginScreen'} />)
        expect(screen.queryByTestId('system-inset-paint')).toBeNull()
    })

    it('renders nothing in the shell when there is no top inset (bottom is never painted)', () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} }
        getSafeAreaInsets.mockReturnValue({ top: 0, right: 0, bottom: 34, left: 0 })
        render(<ShellInsetPainter routeName={'Root'} />)
        expect(screen.queryByTestId('system-inset-paint')).toBeNull()
    })

    it('paints only a top strip, in the login gradient color, on login-like routes', () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} }
        getSafeAreaInsets.mockReturnValue({ top: 59, right: 0, bottom: 34, left: 0 })
        render(<ShellInsetPainter routeName={'LoginScreen'} />)
        const strip = screen.getByTestId('system-inset-paint')
        expect(strip.parentElement).toBe(document.body)
        expect(strip.style.height).toBe('59px')
        expect(strip.style.backgroundColor).toBe('rgb(173, 204, 255)')
    })

    it('paints the theme header color on app routes', () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} }
        getSafeAreaInsets.mockReturnValue({ top: 59, right: 0, bottom: 34, left: 0 })
        render(<ShellInsetPainter routeName={'Root'} />)
        expect(screen.getByTestId('system-inset-paint').parentElement).toBe(document.body)
        expect(screen.getByTestId('system-inset-paint').style.backgroundColor).not.toBe('')
    })
})
