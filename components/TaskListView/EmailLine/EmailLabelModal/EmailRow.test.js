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
})
