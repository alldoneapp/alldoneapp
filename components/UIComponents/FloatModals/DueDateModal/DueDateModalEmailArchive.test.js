import React from 'react'
import renderer, { act } from 'react-test-renderer'
import DueDateModal from './DueDateModal'
import {
    fetchEmailLineMessageStates,
    performEmailLineAction,
} from '../../../../utils/backends/EmailLine/emailLineBackend'

// AT-3164: "Archive email in Gmail" in the postpone dialog of a linked email task.

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
jest.mock('../../../CheckBox', () => 'CheckBox')
jest.mock('../../../ModalsManager/modalsManager', () => ({
    storeModal: jest.fn(),
    removeModal: jest.fn(),
    DUE_DATE_MODAL_ID: 'due-date',
}))
jest.mock('../../../../utils/backends/EmailLine/emailLineBackend', () => ({
    fetchEmailLineMessageStates: jest.fn(),
    performEmailLineAction: jest.fn(),
}))

const CONNECTION = 'email_google_me@example.com'
let messageCounter = 0

// A fresh message id per test: the shared archive helper deduplicates in-flight requests per message.
const emailTask = (gmailData = {}) => ({
    id: 't1',
    done: false,
    dueDate: 123,
    gmailData: {
        origin: 'gmail_label_follow_up',
        messageId: `m${++messageCounter}`,
        connectionProjectId: CONNECTION,
        provider: 'google',
        ...gmailData,
    },
})

const inboxStates = (task, inInbox = true) => [
    { messageId: task.gmailData.messageId, exists: true, unread: true, inInbox },
]

const flush = () => act(async () => {})

const mount = async props => {
    let tree
    await act(async () => {
        tree = renderer.create(
            <DueDateModal projectId="p1" closePopover={jest.fn()} delayClosePopover={jest.fn()} {...props} />
        )
    })
    await flush()
    return tree
}

const findOption = tree => tree.root.findAll(node => node.props.testID === 'postpone-archive-email-option')

let alertSpy
beforeEach(() => {
    jest.clearAllMocks()
    performEmailLineAction.mockResolvedValue({ processed: 1 })
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})
})
afterEach(() => alertSpy.mockRestore())

const gmailMutations = () => performEmailLineAction.mock.calls

describe('visibility and default', () => {
    it('shows the option checked by default while the email is in the inbox', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockResolvedValue(inboxStates(task))
        const tree = await mount({ task, saveDueDateBeforeSaveTask: jest.fn() })

        expect(fetchEmailLineMessageStates).toHaveBeenCalledWith(CONNECTION, [task.gmailData.messageId])
        const options = findOption(tree)
        expect(options.length).toBeGreaterThan(0)
        expect(options[0].props.accessibilityState).toEqual({ checked: true })
        expect(options[0].props.accessibilityLabel).toBe('Archive email in Gmail')
        // Opening the dialog only reads the mailbox.
        expect(gmailMutations()).toHaveLength(0)
    })

    it('hides the option when the email already left the inbox', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockResolvedValue(inboxStates(task, false))
        const tree = await mount({ task, saveDueDateBeforeSaveTask: jest.fn() })
        expect(findOption(tree)).toHaveLength(0)
    })

    it('hides the option when the mailbox could not be asked', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockRejectedValue(new Error('offline'))
        const tree = await mount({ task, saveDueDateBeforeSaveTask: jest.fn() })
        expect(findOption(tree)).toHaveLength(0)
    })

    it('does not look anything up for a task without email', async () => {
        const tree = await mount({ task: { id: 't1', dueDate: 123 }, saveDueDateBeforeSaveTask: jest.fn() })
        expect(fetchEmailLineMessageStates).not.toHaveBeenCalled()
        expect(findOption(tree)).toHaveLength(0)
    })

    it('does not offer it for the edit-mode draft date', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockResolvedValue(inboxStates(task))
        const tree = await mount({ task, inEditTask: true, saveDueDateBeforeSaveTask: jest.fn() })
        expect(fetchEmailLineMessageStates).not.toHaveBeenCalled()
        expect(findOption(tree)).toHaveLength(0)
    })
})

describe('confirmation', () => {
    it('postpones the task, then archives the email when a date is picked with the option checked', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockResolvedValue(inboxStates(task))
        const saveDueDateBeforeSaveTask = jest.fn(async () => {})
        const tree = await mount({ task, saveDueDateBeforeSaveTask })

        await act(async () => {
            await tree.root.findByType('Dates').props.saveDueDateBeforeSaveTask(98765, false)
        })
        await flush()

        // The task comes back on the chosen date in Alldone ...
        expect(saveDueDateBeforeSaveTask).toHaveBeenCalledWith(task, 98765, false)
        // ... and the email only leaves the inbox: the archive action removes INBOX and nothing else.
        expect(gmailMutations()).toEqual([[CONNECTION, { action: 'archive', messageIds: [task.gmailData.messageId] }]])
        expect(alertSpy).not.toHaveBeenCalled()
    })

    it('archives for "Someday" (backlog) too', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockResolvedValue(inboxStates(task))
        const setToBacklogBeforeSaveTask = jest.fn(async () => {})
        const tree = await mount({ task, saveDueDateBeforeSaveTask: jest.fn(), setToBacklogBeforeSaveTask })

        await act(async () => {
            await tree.root.findByType('Dates').props.setToBacklogBeforeSaveTask(false)
        })
        await flush()

        expect(setToBacklogBeforeSaveTask).toHaveBeenCalledWith(task, false)
        expect(gmailMutations()).toHaveLength(1)
        expect(gmailMutations()[0][1].action).toBe('archive')
    })

    it('hands auto postpone a wrapper that archives after its own task write', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockResolvedValue(inboxStates(task))
        const tree = await mount({ task, saveDueDateBeforeSaveTask: jest.fn() })

        const write = jest.fn(async () => 'written')
        await act(async () => {
            await tree.root.findByType('Footer').props.wrapSingleTaskPostpone(write)()
        })
        await flush()

        expect(write).toHaveBeenCalledTimes(1)
        expect(gmailMutations()).toHaveLength(1)
    })

    it('leaves Gmail alone when the option is unchecked', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockResolvedValue(inboxStates(task))
        const saveDueDateBeforeSaveTask = jest.fn(async () => {})
        const tree = await mount({ task, saveDueDateBeforeSaveTask })

        await act(async () => {
            findOption(tree)[0].props.onPress()
        })
        expect(findOption(tree)[0].props.accessibilityState).toEqual({ checked: false })

        const write = jest.fn(async () => {})
        await act(async () => {
            await tree.root.findByType('Dates').props.saveDueDateBeforeSaveTask(98765, false)
            await tree.root.findByType('Footer').props.wrapSingleTaskPostpone(write)()
        })
        await flush()

        expect(saveDueDateBeforeSaveTask).toHaveBeenCalledTimes(1)
        expect(write).toHaveBeenCalledTimes(1)
        expect(gmailMutations()).toHaveLength(0)
    })

    it('leaves Gmail alone when the dialog is cancelled', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockResolvedValue(inboxStates(task))
        const saveDueDateBeforeSaveTask = jest.fn()
        const tree = await mount({ task, saveDueDateBeforeSaveTask })
        expect(findOption(tree).length).toBeGreaterThan(0)

        // Closing (X, Escape, outside click) unmounts the dialog without a date.
        await act(async () => {
            tree.unmount()
        })
        await flush()

        expect(saveDueDateBeforeSaveTask).not.toHaveBeenCalled()
        expect(gmailMutations()).toHaveLength(0)
    })

    it('does not archive when a date is picked before the inbox check answered', async () => {
        const task = emailTask()
        let answer
        fetchEmailLineMessageStates.mockReturnValue(
            new Promise(resolve => {
                answer = resolve
            })
        )
        const saveDueDateBeforeSaveTask = jest.fn(async () => {})
        const tree = await mount({ task, saveDueDateBeforeSaveTask })
        expect(findOption(tree)).toHaveLength(0)

        await act(async () => {
            await tree.root.findByType('Dates').props.saveDueDateBeforeSaveTask(98765, false)
        })
        await act(async () => answer(inboxStates(task)))

        expect(saveDueDateBeforeSaveTask).toHaveBeenCalledTimes(1)
        expect(gmailMutations()).toHaveLength(0)
    })
})

describe('failures are reported separately', () => {
    it('keeps the task postponed and alerts only about the archive when Gmail fails', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockResolvedValue(inboxStates(task))
        performEmailLineAction.mockRejectedValue(new Error('Gmail said no'))
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        const saveDueDateBeforeSaveTask = jest.fn(async () => {})
        const tree = await mount({ task, saveDueDateBeforeSaveTask })

        await act(async () => {
            await tree.root.findByType('Dates').props.saveDueDateBeforeSaveTask(98765, false)
        })
        await flush()

        expect(saveDueDateBeforeSaveTask).toHaveBeenCalledWith(task, 98765, false)
        expect(alertSpy).toHaveBeenCalledTimes(1)
        expect(alertSpy).toHaveBeenCalledWith(
            "The task was postponed, but the email couldn't be archived in Gmail: Gmail said no"
        )
        consoleError.mockRestore()
    })

    it('does not archive when the postpone itself fails, and says the email stayed', async () => {
        const task = emailTask()
        fetchEmailLineMessageStates.mockResolvedValue(inboxStates(task))
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        const saveDueDateBeforeSaveTask = jest.fn(() => Promise.reject(new Error('write failed')))
        const tree = await mount({ task, saveDueDateBeforeSaveTask })

        await act(async () => {
            await tree.root.findByType('Dates').props.saveDueDateBeforeSaveTask(98765, false)
        })
        await flush()

        expect(gmailMutations()).toHaveLength(0)
        expect(alertSpy).toHaveBeenCalledWith("The task couldn't be postponed, so the email was not archived in Gmail")
        consoleError.mockRestore()
    })
})
