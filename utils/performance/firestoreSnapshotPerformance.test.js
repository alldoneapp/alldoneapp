jest.mock('./performanceLogger', () => ({
    startPerformanceTrace: jest.fn(() => ({
        mark: jest.fn(),
        end: jest.fn(),
        fail: jest.fn(),
        isEnded: jest.fn(() => false),
    })),
}))

import { startPerformanceTrace } from './performanceLogger'
import { createFirstSnapshotPerformance } from './firestoreSnapshotPerformance'

describe('first snapshot performance', () => {
    beforeEach(() => jest.clearAllMocks())

    test('keeps the trace open for buffered cache and ends on usable server data', () => {
        const measurement = createFirstSnapshotPerformance({ object_type: 'tasks' })
        const trace = startPerformanceTrace.mock.results[0].value

        measurement.observe({ size: 8, metadata: { fromCache: true } }, true)
        measurement.observe({ size: 10, metadata: { fromCache: false } }, false)

        expect(trace.mark).toHaveBeenCalledWith('cache_buffered', {
            document_count: 8,
            from_cache: true,
        })
        expect(trace.end).toHaveBeenCalledWith('server_ready', {
            document_count: 10,
            from_cache: false,
            outcome: 'success',
        })
    })

    test('records a cache-grace flush as usable data', () => {
        const measurement = createFirstSnapshotPerformance({ object_type: 'notes' })
        const trace = startPerformanceTrace.mock.results[0].value

        measurement.observe({ docs: [{}, {}], metadata: { fromCache: true, isGateFlush: true } }, false)

        expect(trace.end).toHaveBeenCalledWith('cache_grace_ready', {
            document_count: 2,
            from_cache: true,
            outcome: 'success',
        })
    })
})
