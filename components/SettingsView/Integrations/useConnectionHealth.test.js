import React from 'react'
import renderer, { act } from 'react-test-renderer'

import {
    HEALTH_CHECKING,
    HEALTH_CONNECTED,
    HEALTH_RECONNECT_REQUIRED,
    HEALTH_UNKNOWN,
    useConnectionHealth,
} from './useConnectionHealth'
import { runHttpsCallableFunction } from '../../../utils/backends/firestore'

jest.mock('../../../utils/backends/firestore', () => ({
    runHttpsCallableFunction: jest.fn(),
}))

let latest = null

function Probe({ connectionIds }) {
    latest = useConnectionHealth(connectionIds)
    return null
}

function render(connectionIds) {
    let tree
    act(() => {
        tree = renderer.create(<Probe connectionIds={connectionIds} />)
    })
    return tree
}

const A = 'email_google_aaaaaaaa'
const B = 'calendar_google_bbbbbbbb'

beforeEach(() => {
    jest.clearAllMocks()
    latest = null
})

describe('useConnectionHealth', () => {
    test('asks once for every connection and reports each answer', async () => {
        let resolveCall
        runHttpsCallableFunction.mockReturnValue(new Promise(resolve => (resolveCall = resolve)))

        render([A, B])
        expect(latest.healthByConnectionId[A].status).toBe(HEALTH_CHECKING)
        expect(latest.healthByConnectionId[B].status).toBe(HEALTH_CHECKING)

        await act(async () => {
            resolveCall({
                results: [
                    { connectionId: A, status: 'connected' },
                    { connectionId: B, status: 'reconnect_required' },
                ],
            })
        })

        expect(latest.healthByConnectionId[A].status).toBe(HEALTH_CONNECTED)
        expect(latest.healthByConnectionId[B].status).toBe(HEALTH_RECONNECT_REQUIRED)
        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('checkConnectionHealthSecondGen', {
            connectionIds: [A, B].sort(),
        })
    })

    test('a failed check reports unknown, never a broken account', async () => {
        // Offline (the callable funnel fails fast), a cold function, a transport error — all
        // of them mean "we could not ask", and must not tell the user to reconnect.
        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        runHttpsCallableFunction.mockRejectedValue(Object.assign(new Error('offline'), { code: 'offline' }))

        render([A])
        await act(async () => {})

        expect(latest.healthByConnectionId[A].status).toBe(HEALTH_UNKNOWN)
        consoleWarn.mockRestore()
    })

    test('a connection the server did not answer for is unknown, not stuck checking', async () => {
        runHttpsCallableFunction.mockResolvedValue({ results: [{ connectionId: A, status: 'connected' }] })

        render([A, B])
        await act(async () => {})

        expect(latest.healthByConnectionId[A].status).toBe(HEALTH_CONNECTED)
        expect(latest.healthByConnectionId[B].status).toBe(HEALTH_UNKNOWN)
    })

    test('does not re-check on a re-render with the same accounts', async () => {
        runHttpsCallableFunction.mockResolvedValue({ results: [{ connectionId: A, status: 'connected' }] })

        const tree = render([A])
        await act(async () => {})
        // The connection objects are rebuilt on every logged-user snapshot, so this hook is
        // re-rendered constantly. Re-verifying would burn a token refresh each time.
        await act(async () => {
            tree.update(<Probe connectionIds={[A]} />)
        })

        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
    })

    test('checks again when an account is added', async () => {
        runHttpsCallableFunction.mockResolvedValue({ results: [] })

        const tree = render([A])
        await act(async () => {})
        await act(async () => {
            tree.update(<Probe connectionIds={[A, B]} />)
        })

        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
    })

    test('re-verifies on request, so a fixed account stops reporting as broken', async () => {
        // The bug this exists for: redux clears `authInvalid` on a fresh consent, but a
        // stale `reconnect_required` from the check that ran BEFORE the reconnect would keep
        // the card in the broken state until a full remount.
        runHttpsCallableFunction.mockResolvedValueOnce({
            results: [{ connectionId: A, status: 'reconnect_required' }],
        })
        render([A])
        await act(async () => {})
        expect(latest.healthByConnectionId[A].status).toBe(HEALTH_RECONNECT_REQUIRED)

        runHttpsCallableFunction.mockResolvedValueOnce({ results: [{ connectionId: A, status: 'connected' }] })
        await act(async () => {
            latest.recheck()
        })

        expect(latest.healthByConnectionId[A].status).toBe(HEALTH_CONNECTED)
        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
    })

    test('asks nothing when there are no connections', async () => {
        render([])
        await act(async () => {})

        expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    })

    test('ignores an answer that lands after unmount', async () => {
        let resolveCall
        runHttpsCallableFunction.mockReturnValue(new Promise(resolve => (resolveCall = resolve)))
        const tree = render([A])

        act(() => {
            tree.unmount()
        })
        await act(async () => {
            resolveCall({ results: [{ connectionId: A, status: 'connected' }] })
        })

        // Nothing to assert on state; the point is that resolving after unmount does not
        // throw or warn about setting state on an unmounted component.
        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
    })
})
