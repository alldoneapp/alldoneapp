import React from 'react'
import renderer, { act } from 'react-test-renderer'

import Backend from '../../utils/BackendBridge'
import LogInButton, { getGoogleSignInErrorMessage } from './LogInButton'

jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        signInWithGoogleRedirect: jest.fn(),
        consumeGoogleRedirectError: jest.fn(),
    },
}))

const GSI_SCRIPT = 'script[src="https://accounts.google.com/gsi/client"]'

describe('LogInButton', () => {
    let tree

    beforeEach(() => {
        Backend.signInWithGoogleRedirect.mockResolvedValue(null)
        Backend.consumeGoogleRedirectError.mockResolvedValue(null)
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

    const googleButton = () => tree.root.findByProps({ accessibilityLabel: 'Sign in with Google' })

    test('starts the same-window Google flow from our own button', async () => {
        await renderButton()

        await act(async () => {
            await googleButton().props.onPress()
        })

        expect(Backend.signInWithGoogleRedirect).toHaveBeenCalledTimes(1)
        // A redirect is in flight: the button stays busy until the page navigates away.
        expect(googleButton().props.disabled).toBe(true)
    })

    test('never loads the popup-based Google Identity Services button (AT-2919)', async () => {
        await renderButton()

        expect(document.querySelector(GSI_SCRIPT)).toBeNull()
        expect(tree.root.findAllByProps({ accessibilityLabel: 'Sign in with Google' }).length).toBeGreaterThan(0)
    })

    test('shows an actionable error and re-enables the button when sign-in cannot start', async () => {
        const error = Object.assign(new Error('network unavailable'), { code: 'auth/network-request-failed' })
        Backend.signInWithGoogleRedirect.mockRejectedValue(error)
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        await renderButton()

        await act(async () => {
            await googleButton().props.onPress()
        })

        expect(googleButton().props.disabled).toBe(false)
        expect(tree.root.findByProps({ accessibilityLiveRegion: 'polite' }).props.children).toBe(
            'Google sign-in could not be started. Please try again.'
        )
        expect(consoleError).toHaveBeenCalledWith('Error during Google sign-in:', error)
        consoleError.mockRestore()
    })

    test('reports a redirect that came back with an error on the page that receives it', async () => {
        Backend.consumeGoogleRedirectError.mockResolvedValue(
            Object.assign(new Error('boom'), { code: 'auth/internal-error' })
        )
        await renderButton()

        expect(Backend.consumeGoogleRedirectError).toHaveBeenCalledTimes(1)
        expect(tree.root.findByProps({ accessibilityLiveRegion: 'polite' }).props.children).toBe(
            'Google sign-in did not complete. Please try again.'
        )
        expect(googleButton().props.disabled).toBe(false)
    })

    test('stays quiet when there was no failed redirect', async () => {
        await renderButton()

        expect(tree.root.findAllByProps({ accessibilityLiveRegion: 'polite' })).toHaveLength(0)
    })

    test('re-enables the button when the page is restored from the back/forward cache', async () => {
        await renderButton()
        await act(async () => {
            await googleButton().props.onPress()
        })
        expect(googleButton().props.disabled).toBe(true)

        await act(async () => {
            const event = new Event('pageshow')
            event.persisted = true
            window.dispatchEvent(event)
        })

        expect(googleButton().props.disabled).toBe(false)
    })

    test('ignores an ordinary page show', async () => {
        await renderButton()
        await act(async () => {
            await googleButton().props.onPress()
        })

        await act(async () => {
            window.dispatchEvent(new Event('pageshow'))
        })

        expect(googleButton().props.disabled).toBe(true)
    })
})

describe('getGoogleSignInErrorMessage', () => {
    test('sends browsers that cannot run the sign-in to the default browser', () => {
        for (const code of [
            'auth/web-storage-unsupported',
            'auth/operation-not-supported-in-this-environment',
            'auth/popup-blocked',
        ]) {
            expect(getGoogleSignInErrorMessage({ code })).toBe(
                'This browser cannot complete Google sign-in. Please open Alldone in your default browser.'
            )
            expect(getGoogleSignInErrorMessage({ code }, { redirect: true })).toBe(
                'This browser cannot complete Google sign-in. Please open Alldone in your default browser.'
            )
        }
    })

    test('asks to retry anything else', () => {
        expect(getGoogleSignInErrorMessage({ code: 'auth/network-request-failed' })).toBe(
            'Google sign-in could not be started. Please try again.'
        )
        expect(getGoogleSignInErrorMessage(null, { redirect: true })).toBe(
            'Google sign-in did not complete. Please try again.'
        )
    })
})
