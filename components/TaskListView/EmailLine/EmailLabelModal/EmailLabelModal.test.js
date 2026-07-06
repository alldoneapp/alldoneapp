/**
 * @jest-environment jsdom
 */

import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import EmailLabelModal from './EmailLabelModal'
import { listEmailLineMessages, performEmailLineAction } from '../../../../utils/backends/EmailLine/emailLineBackend'

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
}))

jest.mock('../emailLineHelper', () => ({
    getLabelWebUrl: jest.fn(() => 'https://mail'),
    openUrlInNewTab: jest.fn(),
}))

const label = { labelId: 'INBOX', displayName: 'Inbox', kind: 'inbox' }

const renderModal = async () => {
    let tree
    await act(async () => {
        tree = renderer.create(
            <EmailLabelModal
                projectId="p1"
                label={label}
                provider="google"
                emailAddress="me@gmail.com"
                closePopover={() => {}}
            />
        )
        await Promise.resolve()
    })
    return tree
}

const touchableContaining = (tree, text) =>
    tree.root
        .findAll(node => node.type === TouchableOpacity)
        .find(node => node.findAll(child => child.props.children === text).length > 0)

describe('EmailLabelModal', () => {
    beforeEach(() => jest.clearAllMocks())

    it('loads and renders email rows', async () => {
        listEmailLineMessages.mockResolvedValue({
            messages: [
                { messageId: 'm1', from: 'a@ex.com', subject: 'One', snippet: 's', isUnread: true, webUrl: 'u1' },
                { messageId: 'm2', from: 'b@ex.com', subject: 'Two', snippet: 's', isUnread: false, webUrl: 'u2' },
            ],
            nextPageToken: null,
        })

        const tree = await renderModal()

        expect(listEmailLineMessages).toHaveBeenCalledWith('p1', 'INBOX')
        const texts = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(texts).toContain('One')
        expect(texts).toContain('Two')
    })

    it('archives selected messages and removes them from the list', async () => {
        listEmailLineMessages.mockResolvedValue({
            messages: [{ messageId: 'm1', from: 'a@ex.com', subject: 'One', isUnread: true, webUrl: 'u1' }],
            nextPageToken: null,
        })
        performEmailLineAction.mockResolvedValue({ processed: 1 })

        const tree = await renderModal()

        const selectRow = tree.root.find(
            node =>
                node.type === TouchableOpacity &&
                (node.props.accessibilityLabel === 'Select' || node.props.accessibilityLabel === 'Deselect')
        )
        await act(async () => {
            selectRow.props.onPress()
            await Promise.resolve()
        })

        const archiveButton = touchableContaining(tree, 'Archive')
        await act(async () => {
            archiveButton.props.onPress()
            await Promise.resolve()
        })

        expect(performEmailLineAction).toHaveBeenCalledWith('p1', { action: 'archive', messageIds: ['m1'] })
    })

    it('confirms then runs a sweep', async () => {
        listEmailLineMessages.mockResolvedValue({
            messages: [{ messageId: 'm1', from: 'a@ex.com', subject: 'One', isUnread: true, webUrl: 'u1' }],
            nextPageToken: null,
        })
        performEmailLineAction.mockResolvedValue({ processed: 1, remaining: false })

        const tree = await renderModal()

        await act(async () => {
            touchableContaining(tree, 'Mark all read').props.onPress()
            await Promise.resolve()
        })
        await act(async () => {
            touchableContaining(tree, 'Confirm').props.onPress()
            await Promise.resolve()
        })

        expect(performEmailLineAction).toHaveBeenCalledWith('p1', { action: 'markAllRead', labelId: 'INBOX' })
    })
})
