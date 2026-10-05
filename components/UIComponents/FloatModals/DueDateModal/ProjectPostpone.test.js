import React from 'react'
import renderer, { act } from 'react-test-renderer'
import DueDateModal from './DueDateModal'

jest.mock('react-redux', () => ({ useSelector: selector => selector({ currentUser: { uid: 'u1' } }) }))
jest.mock('../../../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({}) }))
jest.mock('../../../../utils/useWindowSize', () => ({
    withWindowSizeHook: Component => props => <Component {...props} windowSize={[1200, 900]} />,
}))
jest.mock('../../../../utils/BackendBridge', () => ({ unwatch: jest.fn() }))
jest.mock('../../../../utils/backends/Goals/goalsFirestore', () => ({ watchGoal: jest.fn() }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({ BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER }))
jest.mock('../../../TaskListView/OpenTasksView/goalPostponeMotion', () => ({ postponeGoalWithMotion: jest.fn() }))
jest.mock('../../../UIControls/CustomScrollView', () => props => <div>{props.children}</div>)
jest.mock('../DueDateCalendarModal/DueDateCalendarModal', () => 'Calendar')
jest.mock('./Header', () => 'Header')
jest.mock('./FixedDueDatesModal', () => 'Dates')
jest.mock('./FixedDueDatesModalFooter', () => 'Footer')
jest.mock('./DueDateCalendarModalFooter', () => 'CalendarFooter')
jest.mock('./GoalBasedModal', () => 'GoalBasedModal')
jest.mock('./TabsList', () => ({ OBSERVERS_TAB: 'observers', ASSIGNEE_TAB: 'assignee' }))
jest.mock('../../../ModalsManager/modalsManager', () => ({
    storeModal: jest.fn(),
    removeModal: jest.fn(),
    DUE_DATE_MODAL_ID: 'due-date',
}))

const mount = (postponeProject, closePopover = jest.fn()) =>
    renderer.create(
        <DueDateModal
            task={{ dueDate: 123 }}
            projectId="p1"
            postponeProject={postponeProject}
            closePopover={closePopover}
            delayClosePopover={closePopover}
        />
    )

it.each([
    ['date', 12345],
    ['backlog', Number.MAX_SAFE_INTEGER],
    ['auto', undefined],
    ['calendar', 54321],
])('sends %s through one project operation and closes only after success', async (choice, date) => {
    let resolve
    const postpone = jest.fn(
        () =>
            new Promise(r => {
                resolve = r
            })
    )
    const close = jest.fn()
    const tree = mount(postpone, close)
    let pending
    await act(async () => {
        if (choice === 'auto') pending = tree.root.findByType('Footer').props.postponeProject()
        else if (choice === 'backlog') pending = tree.root.findByType('Dates').props.setToBacklogBeforeSaveTask(false)
        else if (choice === 'calendar') {
            tree.root.findByType('Footer').props.setVisibleCalendar(true)
        } else pending = tree.root.findByType('Dates').props.saveDueDateBeforeSaveTask(date, false)
    })
    if (choice === 'calendar') {
        await act(async () => {
            pending = tree.root.findByType('Calendar').props.saveDueDateBeforeSaveTask(date, false)
            tree.root.findByType('Calendar').props.closePopover()
        })
    }
    expect(postpone).toHaveBeenCalledWith(date, choice === 'auto' ? 'auto' : 'date')
    expect(close).not.toHaveBeenCalled()
    await act(async () => {
        resolve({ updatedTaskCount: 2 })
        await pending
    })
    expect(close).toHaveBeenCalledTimes(1)
    tree.unmount()
})

it('keeps a failed operation visible with a retryable error and prevents concurrent requests', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    let reject
    const postpone = jest
        .fn()
        .mockImplementationOnce(
            () =>
                new Promise((_resolve, r) => {
                    reject = r
                })
        )
        .mockResolvedValueOnce({ updatedTaskCount: 1 })
    const close = jest.fn()
    const tree = mount(postpone, close)
    let pending
    await act(async () => {
        pending = tree.root.findByType('Dates').props.saveDueDateBeforeSaveTask(12345, false)
    })
    await act(async () => {
        await tree.root.findByType('Dates').props.saveDueDateBeforeSaveTask(999, false)
    })
    expect(postpone).toHaveBeenCalledTimes(1)
    await act(async () => {
        reject(Object.assign(new Error('too many'), { code: 'functions/failed-precondition' }))
        await pending
    })
    expect(close).not.toHaveBeenCalled()
    expect(tree.root.findAllByProps({ accessibilityRole: 'alert' })[0].props.children).toMatch('maximum 450')
    await act(async () => {
        await tree.root.findByType('Dates').props.saveDueDateBeforeSaveTask(12345, false)
    })
    expect(postpone).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
    tree.unmount()
    consoleError.mockRestore()
})
