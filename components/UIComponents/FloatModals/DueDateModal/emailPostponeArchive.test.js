import React from 'react'
import renderer, { act } from 'react-test-renderer'

import {
    getPostponeEmailArchiveData,
    isEmailStillInInbox,
    useEmailPostponeArchiveOption,
    wrapPostponeWithEmailArchive,
} from './emailPostponeArchive'

jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../../utils/backends/EmailLine/emailLineBackend', () => ({
    fetchEmailLineMessageStates: jest.fn(),
    performEmailLineAction: jest.fn(),
}))

const gmailTask = ({ gmailData, ...rest } = {}) => ({
    id: 't1',
    done: false,
    ...rest,
    gmailData: {
        origin: 'gmail_label_follow_up',
        messageId: 'm1',
        connectionProjectId: 'email_google_me@example.com',
        provider: 'google',
        ...gmailData,
    },
})

const flush = () => act(async () => {})

describe('getPostponeEmailArchiveData', () => {
    it('returns the archive target of a single open Gmail task', () => {
        expect(getPostponeEmailArchiveData({ task: gmailTask() })).toEqual({
            connectionProjectId: 'email_google_me@example.com',
            messageIds: ['m1'],
        })
    })

    it.each([
        ['a task without email', { task: { id: 't1', done: false } }],
        ['a done task', { task: gmailTask({ done: true }) }],
        ['a draft without id', { task: { ...gmailTask(), id: undefined } }],
        ['an Outlook task', { task: gmailTask({ gmailData: { provider: 'microsoft' } }) }],
        ['the edit-mode draft date', { task: gmailTask(), inEditTask: true }],
        ['several tasks', { task: gmailTask(), multipleTasks: true }],
        ['a goal and its tasks', { task: gmailTask(), inParentGoal: true }],
        ['a goal reminder', { task: gmailTask(), updateParentGoalReminderDate: jest.fn() }],
        ['a project postpone', { task: gmailTask(), postponeProject: jest.fn() }],
    ])('offers nothing for %s', (label, params) => {
        expect(getPostponeEmailArchiveData(params)).toBeNull()
    })
})

describe('isEmailStillInInbox', () => {
    it('is true only when a linked message is reported in the inbox', () => {
        expect(isEmailStillInInbox([{ messageId: 'm1', exists: true, inInbox: true, unread: false }], ['m1'])).toBe(
            true
        )
        expect(isEmailStillInInbox([{ messageId: 'm1', exists: true, inInbox: false }], ['m1'])).toBe(false)
        expect(isEmailStillInInbox([{ messageId: 'm1', exists: false, inInbox: false }], ['m1'])).toBe(false)
        expect(isEmailStillInInbox([{ messageId: 'other', exists: true, inInbox: true }], ['m1'])).toBe(false)
        // A state the server could not read is omitted: unknown never offers the option.
        expect(isEmailStillInInbox([], ['m1'])).toBe(false)
        expect(isEmailStillInInbox(null, ['m1'])).toBe(false)
    })
})

describe('wrapPostponeWithEmailArchive', () => {
    const archiveData = { connectionProjectId: 'email_google_me@example.com', messageIds: ['m1'] }

    it('returns the write unchanged without an archive target', () => {
        const write = jest.fn()
        expect(wrapPostponeWithEmailArchive(write, { archiveData: null })).toBe(write)
    })

    it('archives (INBOX removal via the archive action) only after the postpone write resolved', async () => {
        const order = []
        let resolveWrite
        const write = jest.fn(
            () =>
                new Promise(resolve => {
                    resolveWrite = resolve
                })
        )
        const archiveEmailAction = jest.fn(async () => {
            order.push('archive')
            return { processed: 1 }
        })
        const notify = jest.fn()
        const pending = wrapPostponeWithEmailArchive(write, { archiveData, archiveEmailAction, notify })()
        await flush()
        expect(archiveEmailAction).not.toHaveBeenCalled()

        order.push('postponed')
        resolveWrite('done')
        await expect(pending).resolves.toBe('done')
        await flush()

        expect(order).toEqual(['postponed', 'archive'])
        // `archive` is the existing action: threads.modify({ removeLabelIds: ['INBOX'] }), so read
        // state and every other label stay as they are. No markRead, no snooze.
        expect(archiveEmailAction).toHaveBeenCalledTimes(1)
        expect(archiveEmailAction).toHaveBeenCalledWith('email_google_me@example.com', {
            action: 'archive',
            messageIds: ['m1'],
        })
        expect(notify).not.toHaveBeenCalled()
    })

    it('does not archive and says so when the postpone fails', async () => {
        const error = new Error('write failed')
        const archiveEmailAction = jest.fn()
        const notify = jest.fn()
        const wrapped = wrapPostponeWithEmailArchive(() => Promise.reject(error), {
            archiveData,
            archiveEmailAction,
            notify,
        })

        await expect(wrapped()).rejects.toBe(error)
        await flush()
        expect(archiveEmailAction).not.toHaveBeenCalled()
        expect(notify).toHaveBeenCalledWith("The task couldn't be postponed, so the email was not archived in Gmail")
    })

    it('keeps the task postponed and reports a failed archive on its own', async () => {
        const archiveEmailAction = jest.fn(() => Promise.reject(new Error('Gmail is down')))
        const notify = jest.fn()
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        const wrapped = wrapPostponeWithEmailArchive(async () => 'postponed', {
            archiveData: { ...archiveData, messageIds: ['m-fail'] },
            archiveEmailAction,
            notify,
        })

        await expect(wrapped()).resolves.toBe('postponed')
        await flush()

        expect(archiveEmailAction).toHaveBeenCalledTimes(1)
        expect(notify).toHaveBeenCalledTimes(1)
        expect(notify).toHaveBeenCalledWith(
            "The task was postponed, but the email couldn't be archived in Gmail: Gmail is down"
        )
        consoleError.mockRestore()
    })
})

describe('useEmailPostponeArchiveOption', () => {
    const archiveData = { connectionProjectId: 'email_google_me@example.com', messageIds: ['m1'] }
    let option
    const Probe = props => {
        option = useEmailPostponeArchiveOption(props.archiveData, { fetchMessageStates: props.fetchMessageStates })
        return null
    }

    it('shows the option, checked, once the email is reported in the inbox', async () => {
        const fetchMessageStates = jest.fn(async () => [{ messageId: 'm1', exists: true, inInbox: true }])
        await act(async () => {
            renderer.create(<Probe archiveData={archiveData} fetchMessageStates={fetchMessageStates} />)
        })
        expect(fetchMessageStates).toHaveBeenCalledWith('email_google_me@example.com', ['m1'])
        expect(option.visible).toBe(true)
        expect(option.checked).toBe(true)
        expect(option.shouldArchive()).toBe(true)

        act(() => option.toggle())
        expect(option.checked).toBe(false)
        expect(option.shouldArchive()).toBe(false)
    })

    it.each([
        ['already archived', async () => [{ messageId: 'm1', exists: true, inInbox: false }]],
        ['deleted', async () => [{ messageId: 'm1', exists: false, inInbox: false }]],
        ['unknown (lookup failed)', async () => Promise.reject(new Error('offline'))],
    ])('hides the option when the email is %s', async (label, fetchMessageStates) => {
        await act(async () => {
            renderer.create(<Probe archiveData={archiveData} fetchMessageStates={fetchMessageStates} />)
        })
        expect(option.visible).toBe(false)
        expect(option.shouldArchive()).toBe(false)
    })

    it('never asks the mailbox for a task without an archive target', async () => {
        const fetchMessageStates = jest.fn()
        await act(async () => {
            renderer.create(<Probe archiveData={null} fetchMessageStates={fetchMessageStates} />)
        })
        expect(fetchMessageStates).not.toHaveBeenCalled()
        expect(option.visible).toBe(false)
        expect(option.shouldArchive()).toBe(false)
    })
})
