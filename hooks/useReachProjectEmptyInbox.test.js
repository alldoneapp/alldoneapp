import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import useReachProjectEmptyInbox from './useReachProjectEmptyInbox'
import {
    hasReachedProjectEmptyInboxDay,
    resetProjectEmptyInboxCelebrationSessionMarkers,
} from '../components/TaskListView/OpenTasksView/projectEmptyInboxCelebrationMarker'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))

/**
 * AT-2492 — the app-wide half of the per-project celebration.
 *
 * It exists because the transition almost never happens on the project's own board. Completing the
 * last task of a project from My Day, from All Projects or from a chat is the ordinary case, and
 * none of those has that project's task section mounted — so without this hook the celebration would
 * only fire for someone who happened to be looking at that one project at the exact moment the write
 * landed. AT-2418 had to fix precisely that narrowness for the all-projects celebration.
 *
 * It only ever writes a record; the once-per-day accounting belongs to the board.
 */

const PINNED_NOW = new Date('2026-09-02T10:00:00Z')
const todayKey = moment(PINNED_NOW).format('YYYY-MM-DD')
const USER = 'user-1'

function Harness() {
    useReachProjectEmptyInbox()
    return <View />
}

describe('useReachProjectEmptyInbox (AT-2492)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        resetProjectEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        jest.useFakeTimers()
        jest.setSystemTime(PINNED_NOW)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    const withSidebarNumbers = sidebarNumbers =>
        useSelector.mockImplementation(selector => selector({ sidebarNumbers, loggedUser: { uid: USER } }))

    const renderWith = sidebarNumbers => {
        withSidebarNumbers(sidebarNumbers)
        let tree
        act(() => {
            tree = renderer.create(<Harness />)
        })
        return tree
    }

    const advanceTo = (tree, sidebarNumbers) => {
        withSidebarNumbers(sidebarNumbers)
        act(() => {
            tree.update(<Harness />)
        })
    }

    it('records the project whose today list just fell to zero', () => {
        const tree = renderWith({ 'project-a': { [USER]: 2 }, 'project-b': { [USER]: 5 } })

        advanceTo(tree, { 'project-a': { [USER]: 0 }, 'project-b': { [USER]: 5 } })

        expect(hasReachedProjectEmptyInboxDay(USER, 'project-a', todayKey)).toBe(true)
        expect(hasReachedProjectEmptyInboxDay(USER, 'project-b', todayKey)).toBe(false)
    })

    /**
     * `clearSidebarTasksAmount` wipes the whole map on a user or project-list change, and the
     * watchers republish it moments later. Reading that gap as "every project was cleared" would
     * arm a celebration for every project the user owns, on every account switch.
     */
    it('ignores counts that merely went away', () => {
        const tree = renderWith({ 'project-a': { [USER]: 3 } })

        advanceTo(tree, {})

        expect(hasReachedProjectEmptyInboxDay(USER, 'project-a', todayKey)).toBe(false)
    })

    /**
     * ...and the other half of that: once a project has left the map, its old positive count must
     * not survive to be compared against the zero it comes back with.
     */
    it('does not resurrect a stale count when a project reappears', () => {
        const tree = renderWith({ 'project-a': { [USER]: 3 } })

        advanceTo(tree, {})
        advanceTo(tree, { 'project-a': { [USER]: 0 } })

        expect(hasReachedProjectEmptyInboxDay(USER, 'project-a', todayKey)).toBe(false)
    })

    it('records nothing for a project that was empty all along', () => {
        const tree = renderWith({ 'project-a': { [USER]: 0 } })

        advanceTo(tree, { 'project-a': { [USER]: 0 } })

        expect(hasReachedProjectEmptyInboxDay(USER, 'project-a', todayKey)).toBe(false)
    })

    /** `loading` shares the map with the projects but is a flag, not a project. */
    it('does not treat the loading flag as a project', () => {
        const tree = renderWith({ loading: true, 'project-a': { [USER]: 1 } })

        advanceTo(tree, { loading: false, 'project-a': { [USER]: 0 } })

        expect(hasReachedProjectEmptyInboxDay(USER, 'project-a', todayKey)).toBe(true)
        expect(hasReachedProjectEmptyInboxDay(USER, 'loading', todayKey)).toBe(false)
    })

    it('only ever looks at the logged user own count', () => {
        const tree = renderWith({ 'project-a': { [USER]: 1, 'user-2': 4 } })

        advanceTo(tree, { 'project-a': { [USER]: 0, 'user-2': 4 } })

        expect(hasReachedProjectEmptyInboxDay(USER, 'project-a', todayKey)).toBe(true)
        expect(hasReachedProjectEmptyInboxDay('user-2', 'project-a', todayKey)).toBe(false)
    })

    it('records several projects cleared in the same update', () => {
        const tree = renderWith({ 'project-a': { [USER]: 1 }, 'project-b': { [USER]: 1 } })

        advanceTo(tree, { 'project-a': { [USER]: 0 }, 'project-b': { [USER]: 0 } })

        expect(hasReachedProjectEmptyInboxDay(USER, 'project-a', todayKey)).toBe(true)
        expect(hasReachedProjectEmptyInboxDay(USER, 'project-b', todayKey)).toBe(true)
    })
})
