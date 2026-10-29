import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity, View } from 'react-native'
import MessageSendStatus from './MessageSendStatus'
import Icon from '../../../Icon'
import { commentOutbox } from '../../../../utils/backends/Chats/commentOutbox'

jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../../utils/backends/Chats/commentOutbox', () => ({
    commentOutbox: { retry: jest.fn(() => Promise.resolve()), update: jest.fn(), remove: jest.fn() },
}))

it('keeps pending status in the author line without replacing the message body', () => {
    const tree = renderer.create(<MessageSendStatus pendingSend={{ status: 'pending' }} />)
    expect(tree.root.findByType(Icon).props.name).toBe('clock')
    expect(tree.root.findByType(View).props.accessibilityLabel).toBe('Saved on this device. Waiting to sync.')
    expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(0)
    tree.unmount()
})

it('retries a failed send with its existing user and permanent ID', async () => {
    const tree = renderer.create(
        <MessageSendStatus pendingSend={{ status: 'failed', userId: 'user', id: 'request' }} dark />
    )
    expect(tree.root.findByType(Icon).props.name).toBe('alert-circle')
    const retry = tree.root.findByType(TouchableOpacity)
    expect(retry.props.accessibilityLabel).toContain('Comment not synced. Saved on this device.')
    await act(async () => retry.props.onPress())
    expect(commentOutbox.retry).toHaveBeenCalledWith('user', 'request')
    tree.unmount()
})

it('shows a queued message as waiting and lets the user send it now or remove it (AT-2922)', () => {
    const pendingSend = { status: 'queued', userId: 'user', id: 'request' }
    const tree = renderer.create(<MessageSendStatus pendingSend={pendingSend} />)
    expect(tree.root.findByType(View).props.accessibilityLabel).toBe(
        'Queued. Sends when the current answer is finished.'
    )
    const [sendNow, remove] = tree.root.findAllByType(TouchableOpacity)
    act(() => sendNow.props.onPress())
    expect(commentOutbox.update).toHaveBeenCalledWith('user', 'request', { forceSend: true })
    act(() => remove.props.onPress())
    expect(commentOutbox.remove).toHaveBeenCalledWith('user', 'request')
    tree.unmount()
})

it('uses the handlers of a caller that queues messages itself (Anna)', () => {
    const onSendNow = jest.fn()
    const onRemove = jest.fn()
    const tree = renderer.create(
        <MessageSendStatus pendingSend={{ status: 'queued' }} onSendNow={onSendNow} onRemove={onRemove} />
    )
    const [sendNow, remove] = tree.root.findAllByType(TouchableOpacity)
    act(() => sendNow.props.onPress())
    act(() => remove.props.onPress())
    expect(onSendNow).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)
    tree.unmount()
})
