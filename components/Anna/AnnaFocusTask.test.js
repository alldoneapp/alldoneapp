import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { useSelector } from 'react-redux'
import { pickNewFocusTask } from '../../utils/backends/Tasks/tasksFirestore'
import AnnaFocusTask from './AnnaFocusTask'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({ pickNewFocusTask: jest.fn() }))
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

beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
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

    it('picks a focus task like completing one does, starting in the default project', async () => {
        let finish
        pickNewFocusTask.mockReturnValue(new Promise(resolve => (finish = resolve)))
        render({})
        await act(async () => button().click())
        expect(pickNewFocusTask).toHaveBeenCalledWith('home', 'u1')
        expect(button().disabled).toBe(true)
        expect(container.querySelector('[data-icon="loader"]')).toBeTruthy()
        await act(async () => finish(true))
        expect(button().disabled).toBe(false)
        expect(button().textContent).toBe('Get a focus task')
    })

    it('says so when no open task is left for today, and when the pick fails', async () => {
        pickNewFocusTask.mockResolvedValueOnce(false)
        render({})
        await act(async () => button().click())
        expect(container.querySelector('[role="status"]').textContent).toBe('No open task for today')

        pickNewFocusTask.mockRejectedValueOnce(new Error('offline'))
        await act(async () => button().click())
        expect(container.querySelector('[role="status"]').textContent).toBe(
            'The focus task could not be picked. Please try again.'
        )
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
