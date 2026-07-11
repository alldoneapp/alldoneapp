/**
 * @jest-environment jsdom
 */

import React from 'react'
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import EmailLabelModal from './EmailLabelModal'
import {
    getCachedEmailLineSections,
    listEmailLineMessages,
    performEmailLineAction,
    performEmailLineSweepInBackground,
} from '../../../../utils/backends/EmailLine/emailLineBackend'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector({ smallScreen: false })),
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: jest.fn((key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)),
}))

// HelperFunctions transitively imports the redux store (and react-hot-keys),
// which jest cannot transform. The modal only needs MODAL_MAX_HEIGHT_GAP.
jest.mock('../../../../utils/HelperFunctions', () => ({ MODAL_MAX_HEIGHT_GAP: 32 }))

jest.mock('../../../../utils/backends/EmailLine/emailLineBackend', () => ({
    listEmailLineMessages: jest.fn(),
    performEmailLineAction: jest.fn(),
    performEmailLineSweepInBackground: jest.fn(),
    fetchEmailLineSummary: jest.fn(() => Promise.resolve(null)),
    invalidateEmailLineSummaryCooldown: jest.fn(),
    getCachedEmailLineSections: jest.fn(() => null),
    cacheEmailLineSections: jest.fn(),
}))

jest.mock('../emailLineHelper', () => ({
    getEmailAccountWebUrl: jest.fn((provider, emailAddress) => `https://account/${provider}/${emailAddress}`),
    getLabelWebUrl: jest.fn(() => 'https://mail'),
    openUrlInNewTab: jest.fn(),
}))

// EmailRow's task link imports transitively pull in the redux store.
jest.mock('../../../../URLSystem/URLTrigger', () => ({ __esModule: true, default: { processUrl: jest.fn() } }))
jest.mock('../../../../utils/NavigationService', () => ({ __esModule: true, default: {} }))
jest.mock('../../../../utils/LinkingHelper', () => ({ getDvMainTabLink: jest.fn(() => '/link') }))

const group = {
    key: 'inbox',
    displayName: 'Inbox',
    isInbox: true,
    threadCount: 7,
    unreadCount: 2,
    sweeping: false,
    entries: [
        {
            connectionId: 'c1',
            provider: 'google',
            emailAddress: 'a@gmail.com',
            labelId: 'INBOX',
            label: { labelId: 'INBOX', displayName: 'Inbox', kind: 'inbox' },
        },
        {
            connectionId: 'c2',
            provider: 'microsoft',
            emailAddress: 'b@outlook.com',
            labelId: 'f_inbox',
            label: { labelId: 'f_inbox', displayName: 'Inbox', kind: 'inbox' },
        },
    ],
}

const messagesByConnection = {
    c1: [
        {
            messageId: 'm1',
            messageIds: ['m1', 'm1b'],
            from: 'a@ex.com',
            subject: 'One',
            snippet: 's',
            isUnread: true,
            webUrl: 'u1',
        },
    ],
    c2: [{ messageId: 'm2', from: 'b@ex.com', subject: 'Two', snippet: 's', isUnread: false, webUrl: 'u2' }],
}

const renderModal = async (closePopover = () => {}, modalGroup = group) => {
    let tree
    await act(async () => {
        tree = renderer.create(<EmailLabelModal group={modalGroup} closePopover={closePopover} />)
        await Promise.resolve()
    })
    return tree
}

const touchableContaining = (tree, text) =>
    tree.root
        .findAll(node => node.type === TouchableOpacity)
        .find(node => node.findAll(child => child.props.children === text).length > 0)

describe('EmailLabelModal', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        // clearAllMocks doesn't reset implementations, so restore the no-cache default each test.
        getCachedEmailLineSections.mockReturnValue(null)
        listEmailLineMessages.mockImplementation(connectionId =>
            Promise.resolve({ messages: messagesByConnection[connectionId] || [], nextPageToken: null })
        )
    })

    it('loads rows from every account of the group and shows account headers', async () => {
        const tree = await renderModal()

        expect(listEmailLineMessages).toHaveBeenCalledWith('c1', 'INBOX')
        expect(listEmailLineMessages).toHaveBeenCalledWith('c2', 'f_inbox')
        const texts = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(texts).toContain('One')
        expect(texts).toContain('Two')
        expect(texts).toContain('Google · a@gmail.com')
        expect(texts).toContain('Microsoft · b@outlook.com')
    })

    it('bounds parallel section loads to protect provider rate limits', async () => {
        let active = 0
        let maxActive = 0
        const resolvers = []
        listEmailLineMessages.mockImplementation(
            () =>
                new Promise(resolve => {
                    active += 1
                    maxActive = Math.max(maxActive, active)
                    resolvers.push(() => {
                        active -= 1
                        resolve({ messages: [], nextPageToken: null })
                    })
                })
        )
        const manyConnections = {
            ...group,
            entries: Array.from({ length: 5 }, (_, index) => ({
                connectionId: `c${index}`,
                provider: 'google',
                emailAddress: `a${index}@gmail.com`,
                labelId: `label-${index}`,
            })),
        }

        let renderPromise
        await act(async () => {
            renderPromise = renderer.create(<EmailLabelModal group={manyConnections} closePopover={() => {}} />)
            await Promise.resolve()
        })
        expect(listEmailLineMessages).toHaveBeenCalledTimes(2)

        while (resolvers.length) {
            const resolve = resolvers.shift()
            await act(async () => {
                resolve()
                await Promise.resolve()
            })
        }

        expect(renderPromise).toBeTruthy()
        expect(listEmailLineMessages).toHaveBeenCalledTimes(5)
        expect(maxActive).toBe(2)
    })

    it('opens the source email account from each account header', async () => {
        const { getEmailAccountWebUrl, openUrlInNewTab } = require('../emailLineHelper')
        const tree = await renderModal()

        const openAccountButton = tree.root
            .findAllByType(TouchableOpacity)
            .find(node => node.props.accessibilityLabel === 'Open email account')

        await act(async () => {
            openAccountButton.props.onPress()
            await Promise.resolve()
        })

        expect(getEmailAccountWebUrl).toHaveBeenCalledWith('google', 'a@gmail.com')
        expect(openUrlInNewTab).toHaveBeenCalledWith('https://account/google/a@gmail.com')
    })

    it('offers one empty-state account link per connection, not per entry', async () => {
        listEmailLineMessages.mockResolvedValue({ messages: [], nextPageToken: null })
        const twoLabelsOneAccount = {
            ...group,
            key: 'acme',
            displayName: 'Acme',
            isInbox: false,
            entries: [
                { connectionId: 'c1', provider: 'google', emailAddress: 'a@gmail.com', labelId: 'Label_acme' },
                { connectionId: 'c1', provider: 'google', emailAddress: 'a@gmail.com', labelId: 'Label_clients_acme' },
            ],
        }

        const tree = await renderModal(() => {}, twoLabelsOneAccount)

        const texts = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(texts).toContain('No emails in inbox with this label')
        // The link's label and the account address are separate children, so match on the first.
        const openAccountLinks = tree.root.findAll(
            node => node.type === Text && node.props.children?.[0] === 'Open email account'
        )
        expect(openAccountLinks).toHaveLength(1)
        expect(openAccountLinks[0].props.children[1]).toBe(' · a@gmail.com')
    })

    it('keeps the modal open on selection archive, routes to the owning connection, and drops the archived row', async () => {
        const closePopover = jest.fn()
        performEmailLineAction.mockResolvedValue({ processed: 1 })

        const tree = await renderModal(closePopover)

        const selectRow = tree.root.findAll(
            node =>
                node.type === TouchableOpacity &&
                (node.props.accessibilityLabel === 'Select' || node.props.accessibilityLabel === 'Deselect')
        )[0]
        await act(async () => {
            selectRow.props.onPress()
            await Promise.resolve()
        })

        const archiveButton = touchableContaining(tree, 'Archive')
        await act(async () => {
            archiveButton.props.onPress()
            await new Promise(resolve => setTimeout(resolve, 0))
        })

        // The modal stays open; only the owning connection's action fires.
        expect(closePopover).not.toHaveBeenCalled()
        expect(performEmailLineAction).toHaveBeenCalledWith('c1', { action: 'archive', messageIds: ['m1', 'm1b'] })
        expect(performEmailLineAction).not.toHaveBeenCalledWith('c2', expect.anything())

        // Once the archive resolves, the archived row drops out while the rest still renders.
        const texts = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(texts).not.toContain('One')
        expect(texts).toContain('Two')
    })

    it('shows a per-row spinner while a selection archive is in flight, then removes the row', async () => {
        let resolveAction
        performEmailLineAction.mockReturnValue(new Promise(resolve => (resolveAction = resolve)))

        const tree = await renderModal()

        const selectRow = tree.root.findAll(
            node =>
                node.type === TouchableOpacity &&
                (node.props.accessibilityLabel === 'Select' || node.props.accessibilityLabel === 'Deselect')
        )[0]
        await act(async () => {
            selectRow.props.onPress()
            await Promise.resolve()
        })

        await act(async () => {
            touchableContaining(tree, 'Archive').props.onPress()
            await Promise.resolve()
        })

        // While in flight the row stays put and shows a spinner.
        expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0)
        const during = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(during).toContain('One')

        await act(async () => {
            resolveAction({ processed: 1 })
            await new Promise(resolve => setTimeout(resolve, 0))
        })

        const after = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(after).not.toContain('One')
        expect(tree.root.findAllByType(ActivityIndicator).length).toBe(0)
    })

    it('drops a re-labeled row but keeps the modal open, deferring the summary refresh until close', async () => {
        const {
            fetchEmailLineSummary,
            invalidateEmailLineSummaryCooldown,
        } = require('../../../../utils/backends/EmailLine/emailLineBackend')
        const tree = await renderModal()

        const rowNode = tree.root.find(
            node =>
                node.props &&
                node.props.row &&
                node.props.row.messageId === 'm1' &&
                typeof node.props.onRelabeled === 'function'
        )
        await act(async () => {
            rowNode.props.onRelabeled(rowNode.props.row)
            await Promise.resolve()
        })

        const texts = () =>
            tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        // The re-labeled row leaves the list, but the modal stays open (other rows still render).
        expect(texts()).not.toContain('One')
        expect(texts()).toContain('Two')
        // No summary refresh while the modal is open — that could unmount the chip and close us.
        expect(fetchEmailLineSummary).not.toHaveBeenCalled()

        // Closing the modal flushes the deferred refresh for the affected connection only.
        await act(async () => {
            tree.unmount()
        })
        expect(invalidateEmailLineSummaryCooldown).toHaveBeenCalledWith('c1')
        expect(fetchEmailLineSummary).toHaveBeenCalledWith('c1', { force: true })
        expect(fetchEmailLineSummary).not.toHaveBeenCalledWith('c2', expect.anything())
    })

    const singleGroup = {
        key: 'work',
        displayName: 'Work',
        isInbox: false,
        threadCount: 5,
        unreadCount: 0,
        sweeping: false,
        entries: [
            {
                connectionId: 'c1',
                provider: 'google',
                emailAddress: 'a@gmail.com',
                labelId: 'L_work',
                label: { labelId: 'L_work', displayName: 'Work' },
            },
        ],
    }
    const workRows = [{ messageId: 'w1', from: 'x@ex.com', subject: 'Work One', snippet: 's', isUnread: true }]
    const cachedWorkSections = messages => [
        {
            connectionId: 'c1',
            labelId: 'L_work',
            provider: 'google',
            emailAddress: 'a@gmail.com',
            label: singleGroup.entries[0].label,
            messages,
            nextPageToken: null,
        },
    ]
    const stringChildren = tree =>
        tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)

    it('keeps cached rows visible while refreshing even when the chip count changed', async () => {
        // Cache holds 1 row, but the chip promises 5: prefer useful stale content over a blank modal.
        getCachedEmailLineSections.mockReturnValue(cachedWorkSections(workRows))
        let resolveList
        listEmailLineMessages.mockReturnValue(new Promise(resolve => (resolveList = resolve)))

        let tree
        await act(async () => {
            tree = renderer.create(<EmailLabelModal group={singleGroup} closePopover={() => {}} />)
            await Promise.resolve()
        })

        // The cached row remains interactive and a compact refresh state is visible.
        expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0)
        expect(stringChildren(tree)).toContain('Work One')
        expect(stringChildren(tree)).toContain('Refreshing')

        // Fresh results land: the spinner clears and the rows render.
        await act(async () => {
            resolveList({ messages: workRows, nextPageToken: null })
            await new Promise(resolve => setTimeout(resolve, 0))
        })
        expect(tree.root.findAllByType(ActivityIndicator).length).toBe(0)
        expect(stringChildren(tree)).toContain('Work One')
    })

    it('renders cached rows instantly without a spinner when they match the chip count', async () => {
        // Chip count equals the cached row count → safe to render immediately during the refresh.
        const matchingGroup = { ...singleGroup, threadCount: 1 }
        getCachedEmailLineSections.mockReturnValue(cachedWorkSections(workRows))
        // Keep the refresh in flight so we assert the pre-refresh render.
        listEmailLineMessages.mockReturnValue(new Promise(() => {}))

        let tree
        await act(async () => {
            tree = renderer.create(<EmailLabelModal group={matchingGroup} closePopover={() => {}} />)
            await Promise.resolve()
        })

        expect(stringChildren(tree)).toContain('Work One')
        expect(tree.root.findAllByType(ActivityIndicator).length).toBe(1)
        expect(stringChildren(tree)).toContain('Refreshing')
    })

    // A backend that throws must never render as "No emails in inbox with this label" — that
    // empty state is what made a total outage (every list call throwing) look like an empty label.
    it('renders the error state with a retry, not the empty state, when every account fails', async () => {
        listEmailLineMessages.mockRejectedValue(new Error('internal'))

        const tree = await renderModal()

        const texts = stringChildren(tree)
        expect(texts).toContain("Couldn't load emails")
        expect(texts).not.toContain('No emails in inbox with this label')

        // The account links stay reachable so the user can still get to their mailbox.
        const openAccountLinks = tree.root.findAll(
            node => node.type === Text && node.props.children?.[0] === 'Open email account'
        )
        expect(openAccountLinks).toHaveLength(2)

        // Retry re-runs the load; once it succeeds the rows replace the error state.
        listEmailLineMessages.mockImplementation(connectionId =>
            Promise.resolve({ messages: messagesByConnection[connectionId] || [], nextPageToken: null })
        )
        await act(async () => {
            touchableContaining(tree, 'Retry').props.onPress()
            await new Promise(resolve => setTimeout(resolve, 0))
        })

        expect(stringChildren(tree)).not.toContain("Couldn't load emails")
        expect(stringChildren(tree)).toContain('One')
        expect(stringChildren(tree)).toContain('Two')
    })

    it('renders the empty state for a genuinely empty label', async () => {
        listEmailLineMessages.mockResolvedValue({ messages: [], nextPageToken: null })

        const tree = await renderModal()

        const texts = stringChildren(tree)
        expect(texts).toContain('No emails in inbox with this label')
        expect(texts).not.toContain("Couldn't load emails")
    })

    it('shows the loaded rows plus a notice naming the accounts when only some sections fail', async () => {
        // c1 throws outright; c2 succeeds but its provider dropped threads it could not fetch.
        listEmailLineMessages.mockImplementation(connectionId =>
            connectionId === 'c1'
                ? Promise.reject(new Error('internal'))
                : Promise.resolve({ messages: messagesByConnection.c2, nextPageToken: null, partialFailure: true })
        )

        const tree = await renderModal()

        const texts = stringChildren(tree)
        // The healthy account's rows still render — the failure must not blank the modal.
        expect(texts).toContain('Two')
        expect(texts).not.toContain("Couldn't load emails")
        expect(texts).not.toContain('No emails in inbox with this label')
        // Both the thrown call and the partial provider failure are named in the notice.
        expect(texts).toContain('Some emails couldn\'t be loaded from N:{"accounts":"a@gmail.com, b@outlook.com"}')
    })

    it('closes immediately on sweep and runs it in the background for every account', async () => {
        const closePopover = jest.fn()
        const tree = await renderModal(closePopover)

        await act(async () => {
            touchableContaining(tree, 'Archive all').props.onPress()
            await Promise.resolve()
        })

        expect(closePopover).toHaveBeenCalled()
        expect(performEmailLineSweepInBackground).toHaveBeenCalledWith('c1', 'INBOX', 'archiveAll')
        expect(performEmailLineSweepInBackground).toHaveBeenCalledWith('c2', 'f_inbox', 'archiveAll')
        expect(performEmailLineAction).not.toHaveBeenCalled()
    })
})
