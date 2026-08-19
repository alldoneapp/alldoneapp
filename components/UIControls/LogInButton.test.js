import React from 'react'
import renderer, { act } from 'react-test-renderer'

import Backend from '../../utils/BackendBridge'
import LogInButton from './LogInButton'

jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        isMobileDevice: jest.fn(),
        isLocalDevHost: jest.fn(),
        loginWithGoogle: jest.fn(),
        signInWithGoogleRedirect: jest.fn(),
    },
}))

describe('LogInButton', () => {
    let tree

    beforeEach(() => {
        Backend.isMobileDevice.mockReturnValue(true)
        Backend.isLocalDevHost.mockReturnValue(false)
        Backend.signInWithGoogleRedirect.mockResolvedValue(null)
        document.body.innerHTML = ''
    })

    afterEach(() => {
        if (tree) {
            act(() => tree.unmount())
            tree = null
        }
        jest.clearAllMocks()
        document.body.innerHTML = ''
    })

    const renderButton = async () => {
        await act(async () => {
            tree = renderer.create(<LogInButton />)
        })
    }

    test('starts the custom Google flow on mobile', async () => {
        await renderButton()

        const button = tree.root.findByProps({ accessibilityLabel: 'Sign in with Google' })
        await act(async () => {
            await button.props.onPress()
        })

        expect(Backend.signInWithGoogleRedirect).toHaveBeenCalledTimes(1)
        expect(tree.root.findByProps({ accessibilityLabel: 'Sign in with Google' }).props.disabled).toBe(true)
    })

    test('shows an actionable error and re-enables the button when sign-in cannot start', async () => {
        const error = Object.assign(new Error('network unavailable'), { code: 'auth/network-request-failed' })
        Backend.signInWithGoogleRedirect.mockRejectedValue(error)
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        await renderButton()

        await act(async () => {
            await tree.root.findByProps({ accessibilityLabel: 'Sign in with Google' }).props.onPress()
        })

        expect(tree.root.findByProps({ accessibilityLabel: 'Sign in with Google' }).props.disabled).toBe(false)
        expect(tree.root.findByProps({ accessibilityLiveRegion: 'polite' }).props.children).toBe(
            'Google sign-in could not be started. Please try again.'
        )
        expect(consoleError).toHaveBeenCalledWith('Error during Google sign-in:', error)
        consoleError.mockRestore()
    })

    test('keeps the Google Identity Services button on desktop', async () => {
        Backend.isMobileDevice.mockReturnValue(false)
        await renderButton()

        expect(tree.root.findAllByProps({ accessibilityLabel: 'Sign in with Google' })).toHaveLength(0)
        expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).not.toBeNull()
        expect(Backend.signInWithGoogleRedirect).not.toHaveBeenCalled()
    })
})
