import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { useSelector } from 'react-redux'
import { pickDifferentFocusTask, pickNewFocusTask } from '../../utils/backends/Tasks/tasksFirestore'
import AnnaFocusTask, { FAST_TICK_MS, LAND_WAIT_TICKS, MIN_TICKS } from './AnnaFocusTask'
import { resetFocusRerollSession } from './annaFocusReroll'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    pickNewFocusTask: jest.fn(),
    pickDifferentFocusTask: jest.fn(),
}))
jest.mock('../Icon', () => ({ name }) => <i data-icon={name} />)

let container
let root
const onOpen = jest.fn()
const render = state => {
    useSelector.mockImplementation(selector =>
        selector({
            loggedUser: {
                uid: 'u1',
                defaultProjectId: 'home',
                inFocusTaskId: '',
                inFocusTaskProjectId: '',
                ...state.loggedUser,
            },
            loggedUserProjects: state.projects ?? [{ id: 'first' }],
            loggedUserProjectsMap: state.projectsMap ?? {},
            taskInFocus: state.taskInFocus ?? null,
            sidebarNumbers: state.sidebarNumbers,
        })
    )
    act(() => root.render(<AnnaFocusTask onOpen={onOpen} />))
}
const button = () => container.querySelector('button.anna-focus-get')
const celebration = () => container.querySelector('.anna-focus-empty-inbox')
const focusLink = () => container.querySelector('a.anna-focus-task')
const rolling = () => container.querySelector('.anna-focus-rolling')
const reroll = () => container.querySelector('button.anna-focus-reroll')
const reelText = () => container.querySelector('.anna-focus-reel-item')?.textContent
// The roll is driven by chained timeouts, each set after the previous tick has rendered.
const advance = ms => {
    for (let elapsed = 0; elapsed < ms; elapsed += 10) act(() => jest.advanceTimersByTime(10))
}
const rollUntilDone = () => {
    for (let elapsed = 0; elapsed < 10000 && rolling(); elapsed += 10) act(() => jest.advanceTimersByTime(10))
    expect(rolling()).toBeNull()
}

beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.clearAllMocks()
    jest.useFakeTimers()
    resetFocusRerollSession()
    window.matchMedia = jest.fn(() => ({ matches: false }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    jest.useRealTimers()
    delete window.matchMedia
})

describe('the focus task in the assistant header', () => {
    it('links the focus task by its plain name and hands it to the shell on a click', () => {
        render({
            loggedUser: { inFocusTaskId: 't1', inFocusTaskProjectId: 'p1' },
            taskInFocus: { id: 't1', name: 'Call **Ben** about the offer', done: false },
        })
        const link = container.querySelector('a.anna-focus-task')
        expect(link.getAttribute('href')).toBe('/projects/p1/tasks/t1/properties')
        // AnnaShell's link interception would open it on the screen beside the chat instead.
        expect(link.hasAttribute('data-anna-open-in-app')).toBe(true)
        expect(link.textContent).toContain('Call Ben about the offer')
        expect(link.getAttribute('aria-label')).toBe('Open focus task: Call Ben about the offer')
        expect(button()).toBeNull()

        const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
        act(() => link.dispatchEvent(click))
        expect(click.defaultPrevented).toBe(true)
        expect(onOpen).toHaveBeenCalledWith({ taskId: 't1', projectId: 'p1' })

        // A modified click keeps the browser's own handling (a new tab).
        onOpen.mockClear()
        const newTab = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true })
        newTab.preventDefault = jest.fn()
        act(() => link.dispatchEvent(newTab))
        expect(onOpen).not.toHaveBeenCalled()
    })

    it('shows the focus icon, then a tag of the task’s project, named in the label too', () => {
        render({
            loggedUser: { inFocusTaskId: 't1', inFocusTaskProjectId: 'p1' },
            taskInFocus: { id: 't1', name: 'Call Ben', done: false },
            projectsMap: { p1: { id: 'p1', name: 'JTL Software - Project Juno', color: '#ff7a00' } },
        })
        const link = container.querySelector('a.anna-focus-task')
        expect([...link.children].map(child => child.className || child.dataset.icon)).toEqual([
            'crosshair',
            'anna-focus-task-project',
            'anna-focus-task-name',
        ])
        const tag = link.querySelector('.anna-focus-task-project')
        expect(tag.textContent).toBe('JTL Software - Project Juno')
        expect(tag.querySelector('.anna-project-dot').style.background).toBe('rgb(255, 122, 0)')
        expect(link.getAttribute('aria-label')).toBe('Open focus task in JTL Software - Project Juno: Call Ben')
    })

    it('shows no tag while the project is not known yet', () => {
        render({
            loggedUser: { inFocusTaskId: 't1', inFocusTaskProjectId: 'p1' },
            taskInFocus: { id: 't1', name: 'Call Ben', done: false },
        })
        expect(container.querySelector('.anna-focus-task-project')).toBeNull()
        expect(container.querySelector('a.anna-focus-task').getAttribute('aria-label')).toBe(
            'Open focus task: Call Ben'
        )
    })

    it('offers to pick one when there is none, a stale one, or a done one', () => {
        render({})
        expect(button().textContent).toBe('Get a focus task')
        render({
            loggedUser: { inFocusTaskId: 't2', inFocusTaskProjectId: 'p1' },
            taskInFocus: { id: 't1', name: 'Old focus' },
        })
        expect(button()).toBeTruthy()
        render({
            loggedUser: { inFocusTaskId: 't1', inFocusTaskProjectId: 'p1' },
            taskInFocus: { id: 't1', name: 'Finished', done: true },
        })
        expect(button()).toBeTruthy()
    })

    it('picks a focus task like completing one does, starting in the default project, rolling meanwhile', async () => {
        let finish
        pickNewFocusTask.mockReturnValue(new Promise(resolve => (finish = resolve)))
        render({})
        await act(async () => button().click())
        expect(pickNewFocusTask).toHaveBeenCalledWith('home', 'u1', { onCandidates: expect.any(Function) })
        // AT-3067: the search shows as a rolling pill, announced once to screen readers.
        expect(button()).toBeNull()
        expect(rolling().getAttribute('aria-busy')).toBe('true')
        expect(rolling().querySelector('[role="status"]').textContent).toBe('Finding a focus task…')
        // No candidates known yet: the reel says what it is doing.
        expect(reelText()).toBe('Finding a focus task…')
        // Only a swap has the "different task" button.
        expect(reroll()).toBeNull()

        // Candidate names roll through the pill like a slot machine.
        act(() =>
            pickNewFocusTask.mock.calls[0][2].onCandidates([
                { id: 'a', name: 'Call **Ben**' },
                { id: 'b', name: 'Pay invoice' },
            ])
        )
        const seen = new Set()
        for (let i = 0; i < 6; i++) {
            advance(FAST_TICK_MS)
            seen.add(reelText())
        }
        expect([...seen].sort()).toEqual(['Call Ben', 'Pay invoice'])

        await act(async () => finish(true))
        // It keeps rolling until the picked task is there, then lands on it.
        expect(rolling()).toBeTruthy()
        render({
            loggedUser: { inFocusTaskId: 'b', inFocusTaskProjectId: 'home' },
            taskInFocus: { id: 'b', name: 'Pay invoice', done: false },
        })
        rollUntilDone()
        expect(focusLink().textContent).toContain('Pay invoice')
        expect(container.querySelector('.anna-focus-pill').className).toContain('anna-focus-landed')
        advance(800)
        expect(container.querySelector('.anna-focus-pill').className).not.toContain('anna-focus-landed')
    })

    // AT-3085: the roll was too fast to read and the waiting text sat above the pill's middle.
    it('rolls at a readable pace for about as long as before', () => {
        expect(FAST_TICK_MS).toBeGreaterThanOrEqual(120)
        // At least about a second of rolling, at most about three more seconds waiting for the task.
        expect(FAST_TICK_MS * MIN_TICKS).toBeGreaterThanOrEqual(1000)
        expect(FAST_TICK_MS * MIN_TICKS).toBeLessThan(1500)
        expect(FAST_TICK_MS * LAND_WAIT_TICKS).toBeLessThan(3500)
    })

    it('keeps the waiting text in place instead of sliding it in again on every tick', async () => {
        pickNewFocusTask.mockReturnValue(new Promise(() => {}))
        render({})
        await act(async () => button().click())
        const item = container.querySelector('.anna-focus-reel-item')
        expect(item.textContent).toBe('Finding a focus task…')
        for (let i = 0; i < 5; i++) advance(FAST_TICK_MS)
        // The same element: its slide-in animation is not restarted, so it stays centred.
        expect(container.querySelector('.anna-focus-reel-item')).toBe(item)

        // Names slide in, one per tick, once candidates are known.
        act(() =>
            pickNewFocusTask.mock.calls[0][2].onCandidates([
                { id: 'a', name: 'Call Ben' },
                { id: 'b', name: 'Pay invoice' },
            ])
        )
        advance(FAST_TICK_MS)
        const first = container.querySelector('.anna-focus-reel-item')
        advance(FAST_TICK_MS)
        expect(container.querySelector('.anna-focus-reel-item')).not.toBe(first)
    })

    it('says so when no open task is left for today, and when the pick fails', async () => {
        pickNewFocusTask.mockResolvedValueOnce(false)
        render({})
        await act(async () => button().click())
        rollUntilDone()
        expect(container.querySelector('[role="status"]').textContent).toBe('No open task for today')

        pickNewFocusTask.mockRejectedValueOnce(new Error('offline'))
        await act(async () => button().click())
        rollUntilDone()
        expect(container.querySelector('[role="status"]').textContent).toBe(
            'The focus task could not be picked. Please try again.'
        )
    })
})

// AT-3067: a button at the pill's right end swaps the focus task for a different one.
describe('a different focus task from the assistant header', () => {
    const FOCUSED = {
        loggedUser: { inFocusTaskId: 't1', inFocusTaskProjectId: 'p1' },
        taskInFocus: { id: 't1', name: 'Call Ben', done: false },
        projectsMap: { p1: { id: 'p1', name: 'Privat', color: '#4c8bf5' } },
    }
    const focusOn = (id, name) => ({
        ...FOCUSED,
        loggedUser: { inFocusTaskId: id, inFocusTaskProjectId: 'p1' },
        taskInFocus: { id, name, done: false },
    })

    it('sits at the pill’s right end as its own labelled button, outside the task link', () => {
        render(FOCUSED)
        const pill = container.querySelector('.anna-focus-pill')
        expect([...pill.children].map(child => child.tagName)).toEqual(['A', 'BUTTON'])
        expect(reroll().getAttribute('aria-label')).toBe('Show a different focus task')
        expect(reroll().getAttribute('title')).toBe('Show a different focus task')
        expect(reroll().getAttribute('type')).toBe('button')
        expect(focusLink().contains(reroll())).toBe(false)
        expect(reroll().querySelector('[data-icon="refresh-cw"]')).toBeTruthy()
    })

    it('rolls, ignores more clicks meanwhile, lands on the new task and skips the old one next time', async () => {
        let finish
        pickDifferentFocusTask.mockReturnValueOnce(new Promise(resolve => (finish = resolve)))
        render(FOCUSED)
        await act(async () => reroll().click())

        expect(pickDifferentFocusTask).toHaveBeenCalledTimes(1)
        expect(pickDifferentFocusTask).toHaveBeenCalledWith('u1', {
            taskId: 't1',
            projectId: 'p1',
            skippedTaskIds: [],
            onCandidates: expect.any(Function),
        })
        // The link is gone while it searches; the button stays in place, busy.
        expect(focusLink()).toBeNull()
        expect(rolling()).toBeTruthy()
        expect(reroll().disabled).toBe(true)
        expect(reroll().getAttribute('aria-busy')).toBe('true')
        // The current task is in the reel from the start.
        expect(reelText()).toBe('Call Ben')
        await act(async () => reroll().click())
        expect(pickDifferentFocusTask).toHaveBeenCalledTimes(1)

        await act(async () => finish('picked'))
        render(focusOn('t2', 'Write offer'))
        rollUntilDone()
        expect(focusLink().textContent).toContain('Write offer')
        expect(container.querySelector('.anna-focus-notice')).toBeNull()
        advance(800)

        // The next click skips Call Ben as well.
        pickDifferentFocusTask.mockResolvedValueOnce('picked')
        await act(async () => reroll().click())
        expect(pickDifferentFocusTask).toHaveBeenLastCalledWith('u1', {
            taskId: 't2',
            projectId: 'p1',
            skippedTaskIds: ['t1'],
            onCandidates: expect.any(Function),
        })
    })

    it('keeps rolling at least a moment, even when the pick answers at once', async () => {
        pickDifferentFocusTask.mockResolvedValueOnce('picked')
        render(FOCUSED)
        await act(async () => reroll().click())
        render(focusOn('t2', 'Write offer'))
        advance(500)
        expect(rolling()).toBeTruthy()
        rollUntilDone()
        expect(focusLink().textContent).toContain('Write offer')
    })

    it('tells the user when it starts over after every task for today was shown', async () => {
        pickDifferentFocusTask.mockResolvedValueOnce('picked')
        render(FOCUSED)
        await act(async () => reroll().click())
        render(focusOn('t2', 'Write offer'))
        rollUntilDone()
        advance(800)

        // t1 is skipped; nothing else is left, so it starts over and lands on t1 again.
        pickDifferentFocusTask.mockResolvedValueOnce('none').mockResolvedValueOnce('picked')
        await act(async () => reroll().click())
        render(FOCUSED)
        rollUntilDone()
        expect(pickDifferentFocusTask.mock.calls.slice(1).map(([, options]) => options.skippedTaskIds)).toEqual([
            ['t1'],
            [],
        ])
        expect(focusLink().textContent).toContain('Call Ben')
        expect(container.querySelector('.anna-focus-notice').getAttribute('role')).toBe('status')
        expect(container.querySelector('.anna-focus-notice').textContent).toBe(
            'You have seen every task for today – starting over'
        )
        advance(4100)
        expect(container.querySelector('.anna-focus-notice')).toBeNull()
    })

    it('keeps the current task when there is no other one', async () => {
        pickDifferentFocusTask.mockResolvedValueOnce('none')
        render(FOCUSED)
        await act(async () => reroll().click())
        rollUntilDone()
        expect(focusLink().textContent).toContain('Call Ben')
        expect(container.querySelector('.anna-focus-notice').textContent).toBe('No other open task for today')
        expect(reroll().disabled).toBe(false)
    })

    it('explains offline and other failures, keeping the current task', async () => {
        pickDifferentFocusTask.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'offline' }))
        render(FOCUSED)
        await act(async () => reroll().click())
        rollUntilDone()
        expect(focusLink().textContent).toContain('Call Ben')
        expect(container.querySelector('.anna-focus-notice').textContent).toBe(
            'You are offline. Reconnect to get a different focus task.'
        )

        pickDifferentFocusTask.mockRejectedValueOnce(new Error('permission-denied'))
        await act(async () => reroll().click())
        rollUntilDone()
        expect(container.querySelector('.anna-focus-notice').textContent).toBe(
            'The focus task could not be picked. Please try again.'
        )
    })

    it('says nothing when a focus the user set by hand took over', async () => {
        pickDifferentFocusTask.mockResolvedValueOnce('superseded')
        render(FOCUSED)
        await act(async () => reroll().click())
        render(focusOn('t9', 'Chosen by hand'))
        rollUntilDone()
        expect(focusLink().textContent).toContain('Chosen by hand')
        expect(container.querySelector('.anna-focus-notice')).toBeNull()
    })

    it('does not roll names under reduced motion', async () => {
        window.matchMedia = jest.fn(query => ({ matches: query.includes('reduce') }))
        pickDifferentFocusTask.mockReturnValueOnce(new Promise(() => {}))
        render(FOCUSED)
        await act(async () => reroll().click())
        act(() => pickDifferentFocusTask.mock.calls[0][1].onCandidates([{ id: 't2', name: 'Write offer' }]))
        for (let i = 0; i < 4; i++) {
            advance(FAST_TICK_MS)
            expect(reelText()).toBe('Finding a focus task…')
        }
    })
})

// AT-3057: with nothing left for today the header celebrates instead of offering the pick.
describe('the empty inbox in the assistant header', () => {
    // Loaded counts (no `loading` key) with an entry for every project of the user.
    const EMPTY = { first: {}, second: { u1: 0, someoneElse: 4 } }
    const PROJECTS = [{ id: 'first' }, { id: 'second' }]

    it('keeps the pick button while a task is due today (non-empty inbox)', () => {
        render({ projects: PROJECTS, sidebarNumbers: { first: { u1: 2 }, second: {} } })
        expect(button().textContent).toBe('Get a focus task')
        expect(celebration()).toBeNull()
    })

    it('celebrates instead of offering the pick when today is genuinely empty', () => {
        render({ projects: PROJECTS, sidebarNumbers: EMPTY })
        expect(button()).toBeNull()
        expect(focusLink()).toBeNull()
        const status = celebration()
        expect(status.getAttribute('role')).toBe('status')
        expect(status.textContent).toBe('Empty inbox for today – well done!')
        expect(status.getAttribute('aria-label')).toBe(
            'Congrats - you have reached empty inbox across all your projects.'
        )
        expect(status.querySelector('[data-icon="check-circle"]')).toBeTruthy()
        // It is not a way to get more work.
        expect(status.querySelector('button, a')).toBeNull()
    })

    it('never mistakes loading or incomplete counts for an empty inbox', () => {
        // The initial store, a project still loading, a torn-down count, no count at all.
        for (const sidebarNumbers of [
            { loading: true },
            { ...EMPTY, loading: true },
            { loading: false },
            undefined,
            // The counts still describe an older, smaller project list.
            { first: {} },
        ]) {
            render({ projects: PROJECTS, sidebarNumbers })
            expect(celebration()).toBeNull()
            expect(button().textContent).toBe('Get a focus task')
        }
        // No projects loaded yet either.
        render({ projects: [], sidebarNumbers: {} })
        expect(celebration()).toBeNull()
        expect(button()).toBeTruthy()
    })

    it('does not celebrate while the focus task is set but not loaded yet', () => {
        render({
            projects: PROJECTS,
            sidebarNumbers: EMPTY,
            loggedUser: { inFocusTaskId: 't1', inFocusTaskProjectId: 'first' },
        })
        expect(celebration()).toBeNull()
        expect(button()).toBeTruthy()
    })

    it('keeps showing an open focus task even when the today count is zero', () => {
        render({
            projects: PROJECTS,
            sidebarNumbers: EMPTY,
            loggedUser: { inFocusTaskId: 't1', inFocusTaskProjectId: 'first' },
            taskInFocus: { id: 't1', name: 'Call Ben', done: false },
        })
        expect(focusLink()).toBeTruthy()
        expect(celebration()).toBeNull()
    })

    it('follows the transitions: loading → empty → a task appears → focused → done → empty', () => {
        render({ projects: PROJECTS, sidebarNumbers: { loading: true } })
        expect(button()).toBeTruthy()

        render({ projects: PROJECTS, sidebarNumbers: EMPTY })
        expect(celebration()).toBeTruthy()
        expect(button()).toBeNull()

        // A task due today arrives: the normal pick is back at once.
        render({ projects: PROJECTS, sidebarNumbers: { ...EMPTY, second: { u1: 1 } } })
        expect(celebration()).toBeNull()
        expect(button().textContent).toBe('Get a focus task')

        // It is picked: the focus task shows as before.
        render({
            projects: PROJECTS,
            sidebarNumbers: { ...EMPTY, second: { u1: 1 } },
            loggedUser: { inFocusTaskId: 't9', inFocusTaskProjectId: 'second' },
            taskInFocus: { id: 't9', name: 'Last one', done: false },
        })
        expect(focusLink().textContent).toContain('Last one')
        expect(celebration()).toBeNull()

        // Completed, and it was the last one for today: celebrate, even before the focus is cleared.
        render({
            projects: PROJECTS,
            sidebarNumbers: EMPTY,
            loggedUser: { inFocusTaskId: 't9', inFocusTaskProjectId: 'second' },
            taskInFocus: { id: 't9', name: 'Last one', done: true },
        })
        expect(focusLink()).toBeNull()
        expect(celebration()).toBeTruthy()

        render({ projects: PROJECTS, sidebarNumbers: EMPTY })
        expect(celebration()).toBeTruthy()
    })
})
