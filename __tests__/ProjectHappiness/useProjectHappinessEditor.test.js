/**
 * AT-2392 — the shared happiness editor.
 *
 * The rating logic used to live inside the "new day" popup and was only ever
 * reachable for the day that had just ended. Settings → Happiness now drives
 * the same logic for a day the user picks, so the two things this suite pins
 * are the ones that only a second, date-switching host can break:
 *
 *   - the AT-2367 deduplication still holds (one rating = one write = one feed
 *     entry), and it is keyed per DAY, so rating Monday and Tuesday the same
 *     way is two writes, not one;
 *   - switching the day never writes a draft onto the wrong day, and never
 *     leaves the previous day's ratings on screen.
 */

import { newDayRecoveryStore, createNewDayRecoveryStore } from '../../utils/newDayRecoveryStore'
import { dayReloadCoordinator, createDayReloadCoordinator } from '../../utils/dayReloadCoordinator'

beforeEach(() => {
    localStorage.clear()
    Object.assign(newDayRecoveryStore, createNewDayRecoveryStore())
    Object.assign(dayReloadCoordinator, createDayReloadCoordinator())
})

import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('../../utils/BackendBridge', () => ({
    setProjectHappiness: jest.fn(() => Promise.resolve()),
    watchProjectHappinessByRange: jest.fn(),
    unwatch: jest.fn(),
}))

import Backend from '../../utils/BackendBridge'
import useProjectHappinessEditor from '../../components/ProjectHappiness/useProjectHappinessEditor'

const PROJECT_A = { id: 'project-a', name: 'Alldone Product' }
const PROJECT_B = { id: 'project-b', name: 'Juno' }

const MONDAY = new Date('2026-08-17T00:00:00.000Z').getTime()
const TUESDAY = new Date('2026-08-18T00:00:00.000Z').getTime()

const trees = new Set()
afterEach(async () => {
    await renderer.act(async () => {
        trees.forEach(tree => tree.unmount())
    })
    trees.clear()
})

const renderEditor = (options = {}) => {
    let editor
    const Probe = props => {
        editor = useProjectHappinessEditor({
            projects: [PROJECT_A, PROJECT_B],
            userId: 'user-1',
            watcherKeyPrefix: 'test_happiness',
            ...options,
            ...props,
        })
        return null
    }

    let tree
    renderer.act(() => {
        tree = renderer.create(<Probe date={options.date} />)
    })

    trees.add(tree)
    return {
        editor: () => editor,
        setDate: date => renderer.act(() => tree.update(<Probe date={date} />)),
        unmount: () => renderer.act(() => tree.unmount()),
    }
}

const lastWrite = () => Backend.setProjectHappiness.mock.calls[Backend.setProjectHappiness.mock.calls.length - 1]

describe('useProjectHappinessEditor (AT-2392)', () => {
    beforeEach(() => jest.clearAllMocks())

    it('stores a rating the moment it is tapped', () => {
        const { editor } = renderEditor({ date: MONDAY })

        renderer.act(() => editor().setRating(PROJECT_A, 4))

        expect(Backend.setProjectHappiness).toHaveBeenCalledTimes(1)
        expect(lastWrite()).toEqual(['project-a', 'user-1', MONDAY, 4, '', PROJECT_A, { recoverable: true }])
        expect(editor().ratings['project-a']).toBe(4)
    })

    it('never writes the same entry twice (AT-2367)', () => {
        const { editor } = renderEditor({ date: MONDAY })

        renderer.act(() => editor().setRating(PROJECT_A, 4))
        renderer.act(() => editor().setRating(PROJECT_A, 4))

        expect(Backend.setProjectHappiness).toHaveBeenCalledTimes(1)
    })

    it('writes again when the rating actually changes', async () => {
        const { editor } = renderEditor({ date: MONDAY })

        renderer.act(() => editor().setRating(PROJECT_A, 4))
        await renderer.act(async () => editor().setRating(PROJECT_A, 2))

        expect(Backend.setProjectHappiness).toHaveBeenCalledTimes(2)
        expect(lastWrite()[3]).toBe(2)
    })

    it('ignores a comment saved with no rating', async () => {
        const { editor } = renderEditor({ date: MONDAY })

        renderer.act(() => editor().setComment(PROJECT_A, 'rough morning'))
        await renderer.act(async () => editor().saveComment(PROJECT_A))

        expect(Backend.setProjectHappiness).not.toHaveBeenCalled()
    })

    it('stores the comment against the rating on blur', async () => {
        const { editor } = renderEditor({ date: MONDAY })

        renderer.act(() => editor().setRating(PROJECT_A, 5))
        renderer.act(() => editor().setComment(PROJECT_A, 'shipped AT-2392'))
        await renderer.act(async () => editor().saveComment(PROJECT_A))

        expect(Backend.setProjectHappiness).toHaveBeenCalledTimes(2)
        expect(lastWrite()).toEqual([
            'project-a',
            'user-1',
            MONDAY,
            5,
            'shipped AT-2392',
            PROJECT_A,
            { recoverable: true },
        ])
    })

    it('rates a second day the same way as the first — the dedupe is per day', () => {
        const { editor, setDate } = renderEditor({ date: MONDAY })

        renderer.act(() => editor().setRating(PROJECT_A, 4))
        setDate(TUESDAY)
        renderer.act(() => editor().setRating(PROJECT_A, 4))

        expect(Backend.setProjectHappiness).toHaveBeenCalledTimes(2)
        expect(Backend.setProjectHappiness.mock.calls[0][2]).toBe(MONDAY)
        expect(Backend.setProjectHappiness.mock.calls[1][2]).toBe(TUESDAY)
    })

    it('flushes an unblurred comment onto the day it was typed on, not the new one', async () => {
        const { editor, setDate } = renderEditor({ date: MONDAY })

        renderer.act(() => editor().setRating(PROJECT_A, 3))
        renderer.act(() => editor().setComment(PROJECT_A, 'monday note'))
        setDate(TUESDAY)

        await renderer.act(async () => {})
        expect(lastWrite()).toEqual(['project-a', 'user-1', MONDAY, 3, 'monday note', PROJECT_A, { recoverable: true }])
    })

    it('clears the previous day off the screen when the day changes', () => {
        const { editor, setDate } = renderEditor({ date: MONDAY })

        renderer.act(() => editor().setRating(PROJECT_A, 4))
        expect(editor().ratings['project-a']).toBe(4)

        setDate(TUESDAY)

        expect(editor().ratings).toEqual({})
        expect(editor().comments).toEqual({})
    })

    it('watches only the selected day, and seeds what is already stored', () => {
        const { editor } = renderEditor({ date: MONDAY })

        expect(Backend.watchProjectHappinessByRange).toHaveBeenCalledTimes(2)
        const [projectId, userId, from, to] = Backend.watchProjectHappinessByRange.mock.calls[0]
        expect([projectId, userId, from, to]).toEqual(['project-a', 'user-1', MONDAY, MONDAY])

        const deliverSnapshot = Backend.watchProjectHappinessByRange.mock.calls[0][5]
        renderer.act(() => deliverSnapshot('project-a', [{ rating: 5, comment: 'stored' }]))

        expect(editor().ratings['project-a']).toBe(5)
        expect(editor().comments['project-a']).toBe('stored')
    })

    it('never re-writes a value it only just read back', () => {
        const { editor } = renderEditor({ date: MONDAY })
        const deliverSnapshot = Backend.watchProjectHappinessByRange.mock.calls[0][5]

        renderer.act(() => deliverSnapshot('project-a', [{ rating: 5, comment: 'stored' }]))
        renderer.act(() => editor().setRating(PROJECT_A, 5))

        expect(Backend.setProjectHappiness).not.toHaveBeenCalled()
    })

    it('does not watch anything while disabled, and detaches on unmount', () => {
        const { unmount } = renderEditor({ date: MONDAY, watchEnabled: false })

        expect(Backend.watchProjectHappinessByRange).not.toHaveBeenCalled()

        const enabled = renderEditor({ date: MONDAY })
        enabled.unmount()

        expect(Backend.unwatch).toHaveBeenCalledWith('test_happiness_project-a')
        expect(Backend.unwatch).toHaveBeenCalledWith('test_happiness_project-b')
    })

    describe('takeDirtyEntries', () => {
        it('snapshots the drafts so a later reset cannot swallow them', async () => {
            const { editor } = renderEditor({ date: MONDAY })

            renderer.act(() => editor().setRating(PROJECT_A, 3))
            renderer.act(() => editor().setComment(PROJECT_A, 'typed, never blurred'))

            const flush = editor().takeDirtyEntries(MONDAY)
            renderer.act(() => editor().reset())
            await renderer.act(async () => {
                await flush()
            })

            expect(lastWrite()).toEqual([
                'project-a',
                'user-1',
                MONDAY,
                3,
                'typed, never blurred',
                PROJECT_A,
                { recoverable: true },
            ])
        })

        it('is a no-op when nothing is pending', async () => {
            const { editor } = renderEditor({ date: MONDAY })

            const flush = editor().takeDirtyEntries(MONDAY)
            await renderer.act(async () => {
                await flush()
            })

            expect(Backend.setProjectHappiness).not.toHaveBeenCalled()
        })
    })

    it('lets a failed write be retried', async () => {
        Backend.setProjectHappiness.mockImplementationOnce(() => Promise.reject(new Error('offline')))
        const onError = jest.fn()
        const { editor } = renderEditor({ date: MONDAY, onError })

        await renderer.act(async () => {
            await editor().setRating(PROJECT_A, 4)
        })
        expect(onError).toHaveBeenCalledWith(expect.any(Error), 'setProjectHappiness')

        renderer.act(() => editor().setRating(PROJECT_A, 4))

        expect(Backend.setProjectHappiness).toHaveBeenCalledTimes(2)
    })
})

describe('useProjectHappinessEditor — what is already stored for the day', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        Backend.watchProjectHappinessByRange.mockReset()
    })

    const answer = entriesByProject => {
        Backend.watchProjectHappinessByRange.mockImplementation(
            (projectId, userId, timestamp1, timestamp2, watcherKey, callback) => {
                if (entriesByProject[projectId]) callback(projectId, entriesByProject[projectId])
            }
        )
    }

    it('reports a stored rating as stored, and an unrated project as null', () => {
        answer({
            'project-a': [{ rating: 4, comment: 'fine', timestamp: MONDAY, updated: 1 }],
            'project-b': [],
        })

        const { editor } = renderEditor({ date: MONDAY })

        expect(editor().storedEntries['project-a']).toEqual({ rating: 4, comment: 'fine', updated: 1 })
        expect(editor().storedEntries['project-b']).toBeNull()
    })

    it('does not count a rating that was only tapped, until the watcher confirms it', () => {
        answer({ 'project-a': [], 'project-b': [] })
        const { editor } = renderEditor({ date: MONDAY })

        renderer.act(() => editor().setRating(PROJECT_A, 3))

        expect(editor().ratings['project-a']).toBe(3)
        expect(editor().storedEntries['project-a']).toBeNull()
    })

    it('forgets the previous day when the day changes', () => {
        answer({ 'project-a': [{ rating: 4, comment: '', timestamp: MONDAY, updated: 1 }] })
        const { editor, setDate } = renderEditor({ date: MONDAY })
        expect(editor().storedEntries['project-a']).toBeTruthy()

        answer({})
        setDate(TUESDAY)

        expect(editor().storedEntries['project-a']).toBeUndefined()
    })
})

it('recovers the unblurred comment after a page reload during a stalled save', async () => {
    Backend.setProjectHappiness
        .mockReset()
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValue(undefined)
    const first = renderEditor({ date: MONDAY })
    renderer.act(() => {
        first.editor().setRating(PROJECT_A, 4)
        first.editor().setComment(PROJECT_A, 'survive the phone reload')
    })
    first.unmount()
    // A new JS context has no in-flight Promise or React refs; only storage remains.
    Object.assign(newDayRecoveryStore, createNewDayRecoveryStore())
    const second = renderEditor({ date: MONDAY })
    expect(second.editor().comments['project-a']).toBe('survive the phone reload')
    await renderer.act(async () => {})
    expect(lastWrite()).toEqual([
        'project-a',
        'user-1',
        MONDAY,
        4,
        'survive the phone reload',
        PROJECT_A,
        { recoverable: true },
    ])
    expect(newDayRecoveryStore.getDraft('user-1', 'project-a', MONDAY)).toBeUndefined()
})

it('does not overwrite an unblurred local comment with a delayed watcher response', () => {
    Backend.setProjectHappiness.mockReset().mockImplementation(() => new Promise(() => {}))
    Backend.watchProjectHappinessByRange.mockReset()
    const current = renderEditor({ date: MONDAY })
    renderer.act(() => {
        current.editor().setRating(PROJECT_A, 4)
        current.editor().setComment(PROJECT_A, 'still typing')
    })
    const answer = Backend.watchProjectHappinessByRange.mock.calls[0][5]
    renderer.act(() => answer('project-a', [{ rating: 2, comment: 'stale server text' }]))
    expect(current.editor().ratings['project-a']).toBe(4)
    expect(current.editor().comments['project-a']).toBe('still typing')
})
