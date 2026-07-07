/**
 * @jest-environment jsdom
 */

import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import EmailLabelModal from './EmailLabelModal'
import {
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

const renderModal = async (closePopover = () => {}) => {
    let tree
    await act(async () => {
        tree = renderer.create(<EmailLabelModal group={group} closePopover={closePopover} />)
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

    it('closes immediately and routes selection actions to the connection owning each selected thread', async () => {
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
            await Promise.resolve()
        })

        expect(closePopover).toHaveBeenCalled()
        expect(performEmailLineAction).toHaveBeenCalledWith('c1', { action: 'archive', messageIds: ['m1', 'm1b'] })
        expect(performEmailLineAction).not.toHaveBeenCalledWith('c2', expect.anything())
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
