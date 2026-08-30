/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react'
import renderer, { act } from 'react-test-renderer'

import useRateLimitedProjectMountQueue from './useRateLimitedProjectMountQueue'

function Harness({
    projectIds,
    projectReadyStates,
    preloadPriorityProjectIndexes,
    onUpdate,
    minIntervalMs = 500,
    maxReadyWaitMs = 5000,
    preloadConcurrency = 1,
    fastFlingConcurrency = 3,
}) {
    const queue = useRateLimitedProjectMountQueue({
        projectIds,
        projectReadyStates,
        preloadPriorityProjectIndexes,
        minIntervalMs,
        maxReadyWaitMs,
        preloadConcurrency,
        fastFlingConcurrency,
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

    it('preloads two projects concurrently but admits them in readiness order', () => {
        let queue
        let tree
        const onUpdate = value => {
            queue = value
        }
        act(() => {
            tree = renderer.create(
                <Harness
                    projectIds={['project-1', 'project-2', 'project-3', 'project-4']}
                    projectReadyStates={[true, false, false, false]}
                    minIntervalMs={0}
                    preloadConcurrency={2}
                    onUpdate={onUpdate}
                />
            )
        })

        act(() => queue.markProjectNearViewport(1))
        expect(queue.preloadingProjectIndexes).toEqual([1, 2])
        expect(queue.mountedProjectCount).toBe(1)

        // Project 3 answering first must not jump ahead of project 2.
        act(() => {
            tree.update(
                <Harness
                    projectIds={['project-1', 'project-2', 'project-3', 'project-4']}
                    projectReadyStates={[true, false, true, false]}
                    minIntervalMs={0}
                    preloadConcurrency={2}
                    onUpdate={onUpdate}
                />
            )
        })
        expect(queue.mountedProjectCount).toBe(1)

        act(() => {
            tree.update(
                <Harness
                    projectIds={['project-1', 'project-2', 'project-3', 'project-4']}
                    projectReadyStates={[true, true, true, false]}
                    minIntervalMs={0}
                    preloadConcurrency={2}
                    onUpdate={onUpdate}
                />
            )
        })
        act(() => jest.runOnlyPendingTimers())

        expect(queue.mountedProjectCount).toBe(2)
        expect(queue.preloadingProjectIndexes).toEqual([2])

        act(() => jest.runOnlyPendingTimers())

        expect(queue.mountedProjectCount).toBe(3)
        expect(queue.preloadingProjectIndexes).toEqual([])
        expect(queue.nextProjectIndex).toBe(3)
    })

    it('reconnects a cached task-bearing project before sequential empty projects', () => {
        let queue
        let tree
        const projectIds = ['project-1', 'project-2', 'project-3', 'project-4', 'project-5']
        const onUpdate = value => {
            queue = value
        }
        act(() => {
            tree = renderer.create(
                <Harness
                    projectIds={projectIds}
                    projectReadyStates={[true, false, false, false, false]}
                    preloadPriorityProjectIndexes={[4]}
                    minIntervalMs={0}
                    preloadConcurrency={2}
                    onUpdate={onUpdate}
                />
            )
        })

        act(() => queue.markProjectNearViewport(1))
        expect(queue.preloadingProjectIndexes).toEqual([4, 1])

        act(() => {
            tree.update(
                <Harness
                    projectIds={projectIds}
                    projectReadyStates={[true, false, false, false, true]}
                    preloadPriorityProjectIndexes={[4]}
                    minIntervalMs={0}
                    preloadConcurrency={2}
                    onUpdate={onUpdate}
                />
            )
        })
        act(() => jest.runOnlyPendingTimers())

        expect(queue.mountedProjectIndexes).toEqual([0, 4])
        expect(queue.preloadingProjectIndexes).toEqual([1])
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

    it('recovers when a fast fling skips the next project sentinel', () => {
        let queue
        act(() => {
            renderer.create(
                <Harness
                    projectIds={['project-1', 'project-2']}
                    projectReadyStates={[true, true]}
                    minIntervalMs={200}
                    onUpdate={value => {
                        queue = value
                    }}
                />
            )
        })

        act(() => queue.markProjectNearViewport(1, false, true))
        expect(queue.preloadingProjectIndex).toBe(1)
        expect(queue.preloadingProjectSkipped).toBe(true)

        act(() => jest.advanceTimersByTime(199))
        expect(queue.mountedProjectCount).toBe(1)

        act(() => jest.advanceTimersByTime(1))
        expect(queue.mountedProjectCount).toBe(2)
        expect(queue.preloadingProjectSkipped).toBe(false)
    })

    it('prioritizes the viewport near the end while backfilling the earliest missing project', () => {
        const projectIds = Array.from({ length: 15 }, (_, index) => `project-${index + 1}`)
        const readiness = Array.from({ length: 15 }, (_, index) => index <= 1)
        let queue
        act(() => {
            renderer.create(
                <Harness
                    projectIds={projectIds}
                    projectReadyStates={readiness}
                    minIntervalMs={0}
                    preloadConcurrency={2}
                    fastFlingConcurrency={3}
                    onUpdate={value => {
                        queue = value
                    }}
                />
            )
        })

        act(() => queue.markProjectNearViewport(1, false, true, [12, 13, 14], true))

        expect(queue.preloadingProjectIndexes).toEqual([12, 13, 1])
        expect(queue.preloadingProjectSkipped).toBe(false)

        // Even though the earliest missing project is already ready, it must
        // not reveal above the viewport while either target project is pending.
        act(() => jest.advanceTimersByTime(4999))
        expect(queue.mountedProjectIndexes).toEqual([0])

        act(() => jest.advanceTimersByTime(1))
        expect(queue.mountedProjectIndexes).toEqual([0, 12])
        expect(queue.mountedProjectCount).toBe(1)

        act(() => jest.runOnlyPendingTimers())
        expect(queue.mountedProjectIndexes).toEqual([0, 12, 13])
        expect(queue.mountedProjectCount).toBe(1)
        expect(queue.preloadingProjectIndexes).toEqual([1])
        expect(queue.preloadingProjectSkipped).toBe(false)
    })

    it('keeps fast-fling background work to one project when only one viewport target remains', () => {
        const projectIds = Array.from({ length: 15 }, (_, index) => `project-${index + 1}`)
        let queue
        act(() => {
            renderer.create(
                <Harness
                    projectIds={projectIds}
                    projectReadyStates={projectIds.map((_, index) => index === 0)}
                    preloadConcurrency={2}
                    fastFlingConcurrency={3}
                    onUpdate={value => {
                        queue = value
                    }}
                />
            )
        })

        act(() => queue.markProjectNearViewport(1, false, true, [14], true))

        expect(queue.preloadingProjectIndexes).toEqual([14, 1])
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
