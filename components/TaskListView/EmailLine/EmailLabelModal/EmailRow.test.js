/**
 * @jest-environment jsdom
 */

import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import EmailRow from './EmailRow'
import { openUrlInNewTab } from '../emailLineHelper'

jest.mock('react-redux', () => ({ useSelector: jest.fn(selector => selector({ smallScreen: false })) }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))
jest.mock('../emailLineHelper', () => ({ openUrlInNewTab: jest.fn() }))
jest.mock('./DraftReplyPopup', () => () => null)
// The backend transitively imports the redux store (and react-hot-keys), which jest
// cannot transform.
jest.mock('../../../../utils/backends/EmailLine/emailLineBackend', () => ({
    submitEmailLabelFeedback: jest.fn(),
}))

const findByLabel = (tree, label) =>
    tree.root.findAll(node => node.type === TouchableOpacity && node.props.accessibilityLabel === label)

describe('EmailRow', () => {
    beforeEach(() => jest.clearAllMocks())

    it('opens the https unsubscribe link', () => {
        const row = {
            messageId: 'm1',
            from: 'News <news@ex.com>',
            subject: 'Sale',
            unsubscribe: { httpsUrl: 'https://ex.com/u', mailto: 'mailto:u@ex.com' },
        }
        let tree
        act(() => {
            tree = renderer.create(<EmailRow row={row} projectId="p1" selected={false} />)
        })
        const [unsub] = findByLabel(tree, 'Unsubscribe')
        act(() => unsub.props.onPress())
        expect(openUrlInNewTab).toHaveBeenCalledWith('https://ex.com/u')
    })

    it('falls back to the message url for mailto-only unsubscribe', () => {
        const row = {
            messageId: 'm1',
            from: 'news@ex.com',
            subject: 'Sale',
            webUrl: 'https://mail/m1',
            unsubscribe: { mailto: 'mailto:u@ex.com' },
        }
        let tree
        act(() => {
            tree = renderer.create(<EmailRow row={row} projectId="p1" selected={false} />)
        })
        const [unsub] = findByLabel(tree, 'Unsubscribe')
        act(() => unsub.props.onPress())
        expect(openUrlInNewTab).toHaveBeenCalledWith('https://mail/m1')
    })

    it('renders no unsubscribe affordance without header data', () => {
        const row = { messageId: 'm1', from: 'a@ex.com', subject: 'Hi', unsubscribe: null }
        let tree
        act(() => {
            tree = renderer.create(<EmailRow row={row} projectId="p1" selected={false} />)
        })
        expect(findByLabel(tree, 'Unsubscribe')).toHaveLength(0)
    })

    it('expands reasoning and sends wrong-label feedback', async () => {
        const { submitEmailLabelFeedback } = require('../../../../utils/backends/EmailLine/emailLineBackend')
        submitEmailLabelFeedback.mockResolvedValue({ learnedRules: '- rule' })
        const row = {
            messageId: 'm1',
            from: 'a@ex.com',
            subject: 'Hi',
            reasoning: 'Weekly digest the user subscribed to.',
            labelName: 'Alldone/Newsletter',
            confidence: 0.9,
        }
        let tree
        act(() => {
            tree = renderer.create(
                <EmailRow row={row} projectId="p1" labelOptions={['Inbox', 'Alldone/Newsletter']} selected={false} />
            )
        })

        const [toggle] = findByLabel(tree, 'Why this label')
        act(() => toggle.props.onPress())

        const texts = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(texts).toContain('Weekly digest the user subscribed to.')
        expect(texts).toContain('Alldone/Newsletter · 90%')

        const [wrong] = findByLabel(tree, 'Wrong label?')
        act(() => wrong.props.onPress())

        // Ancestor touchables (the row content) also contain the text — take the innermost.
        const send = tree.root
            .findAll(node => node.type === TouchableOpacity)
            .filter(node => node.findAll(child => child.props.children === 'Send feedback').length > 0)
            .pop()
        await act(async () => {
            send.props.onPress()
            await Promise.resolve()
        })

        expect(submitEmailLabelFeedback).toHaveBeenCalledWith('p1', {
            messageId: 'm1',
            correctLabel: null,
            note: '',
        })
        const doneTexts = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(doneTexts).toContain('Labeling instructions updated')
    })
})
