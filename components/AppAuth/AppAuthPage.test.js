import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

import AppAuthPage from './AppAuthPage'
import {
    APP_AUTH_STATE_STORAGE_KEY,
    captureAppAuthStateFromLocation,
    clearPendingAppAuthState,
    readPendingAppAuthState,
} from './appAuthState'
import { mintMenubarAppToken } from '../../utils/backends/firestore'

const mockState = { loggedUser: { email: 'fallback@x.y', displayName: 'Fallback', gold: 1 } }
jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => () => {},
}))
jest.mock('../../redux/actions', () => ({ setNavigationRoute: route => ({ type: 'route', route }) }))
jest.mock('../../utils/backends/firestore', () => ({ logEvent: jest.fn(), mintMenubarAppToken: jest.fn() }))
jest.mock('../../URLSystem/URLSystem', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_APP_AUTH: 'APP_AUTH',
}))
jest.mock('../Icon', () => () => null)
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

const VALID_STATE = 'Anna_State-0123456789abcdef'

let root
let container
const callbackParams = () => {
    const href = container.querySelector('a[href^="hybridmeetingguard://"]').getAttribute('href')
    return new URLSearchParams(href.slice(href.indexOf('?') + 1))
}
const renderPage = async () => {
    await act(async () => root.render(<AppAuthPage />))
    await act(async () => {})
}

beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    // jsdom cannot navigate to a custom scheme and reports that through console.error.
    jest.spyOn(console, 'error').mockImplementation(() => {})
    clearPendingAppAuthState()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    mintMenubarAppToken.mockResolvedValue({
        data: { token: 'tok', email: 'k@alldone.app', name: 'Karsten', gold: 7 },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    console.error.mockRestore()
})

it('returns the state Anna sent, after the existing parameters, and forgets it', async () => {
    window.history.replaceState(null, '', `/app-auth?state=${VALID_STATE}`)
    captureAppAuthStateFromLocation()
    expect(window.location.search).toBe('')

    await renderPage()

    const params = callbackParams()
    expect([...params.keys()]).toEqual(['provider', 'token', 'email', 'name', 'gold', 'state'])
    expect(params.get('provider')).toBe('alldone-app')
    expect(params.get('token')).toBe('tok')
    expect(params.get('state')).toBe(VALID_STATE)
    // One-time: once a callback carries it, it is gone from this tab.
    expect(readPendingAppAuthState()).toBeNull()
})

it('returns the state after a redirect login, when only sessionStorage kept it', async () => {
    // What a Google redirect leaves behind: no address-bar state, no memory, the stored record.
    window.sessionStorage.setItem(
        APP_AUTH_STATE_STORAGE_KEY,
        JSON.stringify({ state: VALID_STATE, savedAt: Date.now() - 60 * 1000 })
    )
    window.history.replaceState(null, '', '/app-auth')

    await renderPage()

    expect(callbackParams().get('state')).toBe(VALID_STATE)
})

it('keeps the state for a retry after a failed token request', async () => {
    window.history.replaceState(null, '', `/app-auth?state=${VALID_STATE}`)
    captureAppAuthStateFromLocation()
    mintMenubarAppToken.mockRejectedValueOnce(new Error('offline'))

    await renderPage()
    expect(container.querySelector('a[href^="hybridmeetingguard://"]')).toBeNull()
    expect(readPendingAppAuthState()).toBe(VALID_STATE)
})

it('sends no state when Anna sent an invalid one', async () => {
    window.history.replaceState(null, '', '/app-auth?state=not%20valid')
    captureAppAuthStateFromLocation()

    await renderPage()

    expect(callbackParams().has('state')).toBe(false)
    expect(callbackParams().get('token')).toBe('tok')
})

it('sends no state for an older Anna that opened the page without one', async () => {
    window.history.replaceState(null, '', '/app-auth')
    captureAppAuthStateFromLocation()

    await renderPage()

    expect([...callbackParams().keys()]).toEqual(['provider', 'token', 'email', 'name', 'gold'])
})
