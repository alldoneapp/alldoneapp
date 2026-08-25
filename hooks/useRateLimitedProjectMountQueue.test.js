/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react'
import renderer, { act } from 'react-test-renderer'

import useRateLimitedProjectMountQueue from './useRateLimitedProjectMountQueue'

function Harness({ projectIds, projectReadyStates, onUpdate, minIntervalMs = 500, maxReadyWaitMs = 5000 }) {
    const queue = useRateLimitedProjectMountQueue({
        projectIds,
        projectReadyStates,
        minIntervalMs,
        maxReadyWaitMs,
    })

    useEffect(() => onUpdate(queue), [onUpdate, queue])
    return null
}

describe('useRateLimitedProjectMountQueue', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('mounts only the first project until the next placeholder is near', () => {
        let queue
        act(() => {
            renderer.create(
                <Harness
                    projectIds={['project-1', 'project-2']}
                    projectReadyStates={[true, false]}
                    onUpdate={value => {
                        queue = value
                    }}
                />
            )
        })

        expect(queue.mountedProjectCount).toBe(1)
        expect(queue.preloadingProjectIndex).toBeNull()
        expect(queue.nextProjectIndex).toBe(1)
        act(() => jest.advanceTimersByTime(5000))
        expect(queue.mountedProjectCount).toBe(1)
    })

    it('preloads one near project immediately and admits it after its own task streams are ready', () => {
        let queue
        let tree
        const onUpdate = value => {
            queue = value
        }
        act(() => {
            tree = renderer.create(
                <Harness
                    projectIds={['project-1', 'project-2', 'project-3']}
                    projectReadyStates={[true, false, false]}
                    minIntervalMs={0}
                    onUpdate={onUpdate}
                />
            )
        })

        act(() => queue.markProjectNearViewport(1))
        expect(queue.preloadingProjectIndex).toBe(1)
        expect(queue.mountedProjectCount).toBe(1)

        act(() => {
            tree.update(
                <Harness
                    projectIds={['project-1', 'project-2', 'project-3']}
                    projectReadyStates={[true, true, false]}
                    minIntervalMs={0}
                    onUpdate={onUpdate}
                />
            )
        })
        act(() => jest.runOnlyPendingTimers())

        expect(queue.mountedProjectCount).toBe(2)
        expect(queue.preloadingProjectIndex).toBeNull()
        expect(queue.nextProjectIndex).toBe(2)
    })

    it('keeps the ghost visible for the full interval after it reaches the viewport', () => {
        let queue
        act(() => {
            renderer.create(
                <Harness
                    projectIds={['project-1', 'project-2']}
                    projectReadyStates={[true, true]}
                    minIntervalMs={1500}
                    onUpdate={value => {
                        queue = value
                    }}
                />
            )
        })

        // Time spent above the placeholder must not consume its visible lifetime.
        act(() => jest.advanceTimersByTime(5000))
        act(() => queue.markProjectNearViewport(1))
        act(() => jest.advanceTimersByTime(1499))
        expect(queue.mountedProjectCount).toBe(1)

        act(() => jest.advanceTimersByTime(1))
        expect(queue.mountedProjectCount).toBe(2)
    })

    it('keeps a started preload alive when layout pushes the ghost back out of view', () => {
        let queue
        act(() => {
            renderer.create(
                <Harness
                    projectIds={['project-1', 'project-2']}
                    projectReadyStates={[true, true]}
                    minIntervalMs={1500}
                    onUpdate={value => {
                        queue = value
                    }}
                />
            )
        })

        act(() => queue.markProjectNearViewport(1, true))
        act(() => jest.advanceTimersByTime(750))
        act(() => queue.markProjectNearViewport(1, false))
        expect(queue.preloadingProjectIndex).toBe(1)
        act(() => jest.advanceTimersByTime(750))
        expect(queue.mountedProjectCount).toBe(2)
    })

    it('waits for readiness but falls back when one project does not answer', () => {
        let queue
        act(() => {
            renderer.create(
                <Harness
                    projectIds={['project-1', 'project-2']}
                    projectReadyStates={[false, false]}
                    minIntervalMs={0}
                    maxReadyWaitMs={5000}
                    onUpdate={value => {
                        queue = value
                    }}
                />
            )
        })

        act(() => queue.markProjectNearViewport(1))
        expect(queue.preloadingProjectIndex).toBe(1)
        act(() => jest.advanceTimersByTime(4999))
        expect(queue.mountedProjectCount).toBe(1)

        act(() => jest.advanceTimersByTime(1))
        expect(queue.mountedProjectCount).toBe(2)
    })

    it('ignores intersections from projects that are not next in line', () => {
        let queue
        act(() => {
            renderer.create(
                <Harness
                    projectIds={['project-1', 'project-2', 'project-3']}
                    projectReadyStates={[true, true, false]}
                    minIntervalMs={0}
                    onUpdate={value => {
                        queue = value
                    }}
                />
            )
        })

        act(() => queue.markProjectNearViewport(2))
        act(() => jest.runOnlyPendingTimers())
        expect(queue.mountedProjectCount).toBe(1)
        expect(queue.preloadingProjectIndex).toBeNull()
    })
})
