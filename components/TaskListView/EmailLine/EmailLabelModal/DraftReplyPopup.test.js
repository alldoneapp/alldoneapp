/**
 * @jest-environment jsdom
 */

import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import DraftReplyPopup from './DraftReplyPopup'
import { performEmailLineAction } from '../../../../utils/backends/EmailLine/emailLineBackend'
import { openUrlInNewTab } from '../emailLineHelper'

jest.mock('../../../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))

jest.mock('../../../../utils/backends/EmailLine/emailLineBackend', () => ({
    performEmailLineAction: jest.fn(),
}))

jest.mock('../emailLineHelper', () => ({ openUrlInNewTab: jest.fn() }))

const touchableContaining = (tree, text) =>
    tree.root
        .findAll(node => node.type === TouchableOpacity)
        .find(node => node.findAll(child => child.props.children === text).length > 0)

describe('DraftReplyPopup', () => {
    beforeEach(() => jest.clearAllMocks())

    it('drafts a reply and shows the Open draft link', async () => {
        performEmailLineAction.mockResolvedValue({ draftUrl: 'https://mail/draft' })

        let tree
        act(() => {
            tree = renderer.create(<DraftReplyPopup projectId="p1" messageId="m1" closePopover={() => {}} />)
        })

        await act(async () => {
            touchableContaining(tree, 'Draft reply').props.onPress()
            await Promise.resolve()
        })

        expect(performEmailLineAction).toHaveBeenCalledWith('p1', {
            action: 'draftReply',
            messageIds: ['m1'],
            guidance: '',
        })

        const openDraft = touchableContaining(tree, 'Open draft')
        expect(openDraft).toBeTruthy()
        act(() => openDraft.props.onPress())
        expect(openUrlInNewTab).toHaveBeenCalledWith('https://mail/draft')
    })

    it('shows a not-enough-gold error', async () => {
        performEmailLineAction.mockRejectedValue(new Error('INSUFFICIENT_GOLD'))

        let tree
        act(() => {
            tree = renderer.create(<DraftReplyPopup projectId="p1" messageId="m1" closePopover={() => {}} />)
        })

        await act(async () => {
            touchableContaining(tree, 'Draft reply').props.onPress()
            await Promise.resolve()
        })

        const texts = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(texts).toContain('Not enough Gold')
    })
})
