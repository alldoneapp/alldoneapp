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
            loggedUserProjects: [{ id: 'first' }],
            taskInFocus: state.taskInFocus ?? null,
        })
    )
    act(() => root.render(<AnnaFocusTask onOpen={onOpen} />))
}
const button = () => container.querySelector('button.anna-focus-get')

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
