import { getHeartbeatStatusForUser } from './heartbeatStatusHelper'

describe('heartbeatStatusHelper', () => {
    test('marks the last check as executed when execution is newer than the last check', () => {
        const status = getHeartbeatStatusForUser(
            {
                heartbeatLastProcessedWindowByUser: { user1: 1000 },
                heartbeatLastExecutedByUser: { user1: 2000 },
            },
            'user1',
            15 * 60 * 1000,
            2500
        )

        expect(status).toEqual({
            lastCheckedAt: 1000,
            lastExecutedAt: 2000,
            hasRecentCheck: true,
            lastResult: 'executed',
        })
    })

    test('marks the last check as not executed when there is no matching execution', () => {
        const status = getHeartbeatStatusForUser(
            {
                heartbeatLastProcessedWindowByUser: { user1: 3000 },
                heartbeatLastExecutedByUser: { user1: 2000 },
            },
            'user1',
            10 * 60 * 1000,
            4000
        )

        expect(status).toEqual({
            lastCheckedAt: 3000,
            lastExecutedAt: 2000,
            hasRecentCheck: true,
            lastResult: 'not_executed',
        })
    })

    test('reports no checks when the user has no heartbeat timestamps', () => {
        const status = getHeartbeatStatusForUser({}, 'user1', 10 * 60 * 1000, 4000)

        expect(status).toEqual({
            lastCheckedAt: null,
            lastExecutedAt: null,
            hasRecentCheck: false,
            lastResult: 'never',
        })
    })

    test('uses the explicit last checked timestamp when available', () => {
        const status = getHeartbeatStatusForUser(
            {
                heartbeatLastCheckedByUser: { user1: 5000 },
                heartbeatLastProcessedWindowByUser: { user1: 3000 },
                heartbeatLastExecutedByUser: { user1: 4500 },
            },
            'user1',
            5 * 60 * 1000,
            6000
        )

        expect(status).toEqual({
            lastCheckedAt: 5000,
            lastExecutedAt: 4500,
            hasRecentCheck: true,
            lastResult: 'not_executed',
        })
    })
})
