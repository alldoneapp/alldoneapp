/** @jest-environment jsdom */

jest.mock('../analytics/analytics', () => ({ trackEvent: jest.fn() }))
jest.mock('./performanceDiagnostics', () => ({ isPerformanceDebugEnabled: jest.fn(() => false) }))

import { trackEvent } from '../analytics/analytics'
import {
    __resetPerformanceLoggerForTests,
    PERFORMANCE_EVENT_NAME,
    sanitizePerformanceMetadata,
    startPerformanceTrace,
} from './performanceLogger'

describe('performance logger', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        __resetPerformanceLoggerForTests()
    })

    test('emits cumulative and per-phase duration for one sampled trace', () => {
        const now = jest.spyOn(performance, 'now')
        now.mockReturnValueOnce(100).mockReturnValueOnce(145).mockReturnValueOnce(220)

        const trace = startPerformanceTrace(
            'app_boot',
            { project_count: 14, project_id: 'private-project-id' },
            { sampleRate: 1 }
        )
        trace.mark('user_loaded')
        trace.end('app_ready', { outcome: 'success' })

        expect(trackEvent).toHaveBeenNthCalledWith(
            1,
            PERFORMANCE_EVENT_NAME,
            expect.objectContaining({
                trace_name: 'app_boot',
                phase: 'user_loaded',
                duration_ms: 45,
                step_duration_ms: 45,
                project_count: 14,
            })
        )
        expect(trackEvent).toHaveBeenNthCalledWith(
            2,
            PERFORMANCE_EVENT_NAME,
            expect.objectContaining({
                phase: 'app_ready',
                duration_ms: 120,
                step_duration_ms: 75,
                outcome: 'success',
            })
        )
        expect(JSON.stringify(trackEvent.mock.calls)).not.toContain('private-project-id')
        now.mockRestore()
    })

    test('drops ids, objects and unknown fields from performance metadata', () => {
        expect(
            sanitizePerformanceMetadata({
                task_count: 12,
                from_cache: true,
                source: 'assignee',
                task_id: 'secret',
                arbitrary: { nested: true },
            })
        ).toEqual({ task_count: 12, from_cache: true, source: 'assignee' })
    })

    test('does not emit an unsampled trace', () => {
        const trace = startPerformanceTrace('page_load', {}, { sampleRate: 0 })
        trace.end('page_ready')

        expect(trackEvent).not.toHaveBeenCalled()
    })
})
