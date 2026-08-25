/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react'
import renderer, { act } from 'react-test-renderer'

import useRateLimitedProjectReveal from './useRateLimitedProjectReveal'

function Harness({
    projectIds,
    readyProjectIds,
    onUpdate,
    minIntervalMs = 500,
    maxReadyWaitMs = 5000,
    requireNearViewport = false,
}) {
    const reveal = useRateLimitedProjectReveal({
        projectIds,
        readyProjectIds,
        resetKey: [...projectIds].sort().join(':'),
        minIntervalMs,
        maxReadyWaitMs,
        requireNearViewport,
    })
    useEffect(() => onUpdate(reveal), [onUpdate, reveal])
    return null
}

describe('useRateLimitedProjectReveal', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('starts with only the first project', () => {
        let reveal
        act(() => {
            renderer.create(
                <Harness
                    projectIds={['p1', 'p2', 'p3']}
                    readyProjectIds={[]}
                    onUpdate={value => {
                        reveal = value
                    }}
                />
            )
        })

        expect(reveal.revealedProjectIds).toEqual(['p1'])
        expect(reveal.primaryProjectId).toBe('p1')
    })

    it('reveals the next project after the previous snapshot and minimum interval', () => {
        let reveal
        let tree
        const onUpdate = value => {
            reveal = value
        }
        act(() => {
            tree = renderer.create(<Harness projectIds={['p1', 'p2', 'p3']} readyProjectIds={[]} onUpdate={onUpdate} />)
        })

        act(() => {
            tree.update(<Harness projectIds={['p1', 'p2', 'p3']} readyProjectIds={['p1']} onUpdate={onUpdate} />)
            jest.advanceTimersByTime(499)
        })
        expect(reveal.revealedProjectIds).toEqual(['p1'])

        act(() => jest.advanceTimersByTime(1))
        expect(reveal.revealedProjectIds).toEqual(['p1', 'p2'])
    })

    it('keeps revealed ids mounted when snapshots reorder the list', () => {
        let reveal
        let tree
        const onUpdate = value => {
            reveal = value
        }
        act(() => {
            tree = renderer.create(
                <Harness
                    projectIds={['p1', 'p2', 'p3']}
                    readyProjectIds={['p1']}
                    minIntervalMs={0}
                    onUpdate={onUpdate}
                />
            )
        })
        act(() => jest.runOnlyPendingTimers())
        expect(reveal.revealedProjectIds).toEqual(['p1', 'p2'])

        act(() => {
            tree.update(
                <Harness
                    projectIds={['p3', 'p2', 'p1']}
                    readyProjectIds={['p1']}
                    minIntervalMs={0}
                    onUpdate={onUpdate}
                />
            )
        })
        expect(reveal.revealedProjectIds).toEqual(['p1', 'p2'])
    })

    it('uses the safety timeout when a project never reports ready', () => {
        let reveal
        act(() => {
            renderer.create(
                <Harness
                    projectIds={['p1', 'p2']}
                    readyProjectIds={[]}
                    minIntervalMs={0}
                    maxReadyWaitMs={5000}
                    onUpdate={value => {
                        reveal = value
                    }}
                />
            )
        })

        act(() => jest.advanceTimersByTime(4999))
        expect(reveal.revealedProjectIds).toEqual(['p1'])
        act(() => jest.advanceTimersByTime(1))
        expect(reveal.revealedProjectIds).toEqual(['p1', 'p2'])
    })

    it('keeps offscreen projects dormant until the next placeholder nears the viewport', () => {
        let reveal
        act(() => {
            renderer.create(
                <Harness
                    projectIds={['p1', 'p2', 'p3']}
                    readyProjectIds={['p1']}
                    minIntervalMs={0}
                    requireNearViewport
                    onUpdate={value => {
                        reveal = value
                    }}
                />
            )
        })

        act(() => jest.advanceTimersByTime(5000))
        expect(reveal.revealedProjectIds).toEqual(['p1'])
        expect(reveal.nextProjectId).toBe('p2')

        act(() => reveal.markProjectNearViewport('p2'))
        act(() => jest.runOnlyPendingTimers())

        expect(reveal.revealedProjectIds).toEqual(['p1', 'p2'])
        expect(reveal.nextProjectId).toBe('p3')
    })

    it('keeps a viewport ghost visible for the minimum interval before admitting its project', () => {
        let reveal
        act(() => {
            renderer.create(
                <Harness
                    projectIds={['p1', 'p2']}
                    readyProjectIds={['p1']}
                    minIntervalMs={500}
                    requireNearViewport
                    onUpdate={value => {
                        reveal = value
                    }}
                />
            )
        })

        // Even if the previous project has been mounted for a long time, the
        // newly visible ghost gets its own full display interval.
        act(() => jest.advanceTimersByTime(5000))
        act(() => reveal.markProjectNearViewport('p2'))
        act(() => jest.advanceTimersByTime(499))
        expect(reveal.revealedProjectIds).toEqual(['p1'])

        act(() => jest.advanceTimersByTime(1))
        expect(reveal.revealedProjectIds).toEqual(['p1', 'p2'])
    })
})
