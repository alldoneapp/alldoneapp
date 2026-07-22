import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native'
import { Provider } from 'react-redux'
import { createStore } from 'redux'

import MarkAsRead from './MarkAsRead'
import { markMessagesAsRead } from '../../utils/backends/Chats/chatsComments'

jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    markMessagesAsRead: jest.fn(),
}))
jest.mock('../../i18n/TranslationService', () => ({
    translate: text => text,
}))

const renderButton = props => {
    const store = createStore(() => ({ chatsActiveTab: 'followed' }))
    return renderer.create(
        <Provider store={store}>
            <MarkAsRead userId="user-1" {...props} />
        </Provider>
    )
}

describe('MarkAsRead', () => {
    beforeEach(() => {
        markMessagesAsRead.mockReset()
    })

    it('marks every supplied project and stays disabled while the requests are running', async () => {
        const finishRequests = []
        markMessagesAsRead.mockImplementation(
            () =>
                new Promise(resolve => {
                    finishRequests.push(resolve)
                })
        )
        const tree = renderButton({ projectIds: ['project-1', 'project-2'] })
        const button = tree.root.findByType(TouchableOpacity)

        let markPromise
        act(() => {
            markPromise = button.props.onPress()
        })

        expect(markMessagesAsRead).toHaveBeenCalledTimes(2)
        expect(markMessagesAsRead).toHaveBeenNthCalledWith(1, 'project-1', 'user-1', 'followed')
        expect(markMessagesAsRead).toHaveBeenNthCalledWith(2, 'project-2', 'user-1', 'followed')
        expect(tree.root.findByType(TouchableOpacity).props.disabled).toBe(true)
        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1)

        await act(async () => {
            finishRequests.forEach(resolve => resolve())
            await markPromise
        })

        expect(tree.root.findByType(TouchableOpacity).props.disabled).toBe(false)
        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0)
    })

    it('shows a retry state when a project update fails', async () => {
        markMessagesAsRead.mockRejectedValueOnce(new Error('offline'))
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        const tree = renderButton({ projectIds: ['project-1'] })

        await act(async () => {
            await tree.root.findByType(TouchableOpacity).props.onPress()
        })

        expect(tree.root.findByType(TouchableOpacity).props.disabled).toBe(false)
        expect(tree.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe(
            'Could not mark as read. Try again'
        )
        expect(tree.root.findAllByType(Text).some(item => item.props.children === 'try again')).toBe(true)
        consoleError.mockRestore()
    })

    it('is disabled when there are no accessible projects', () => {
        const tree = renderButton({ projectIds: [] })

        expect(tree.root.findByType(TouchableOpacity).props.disabled).toBe(true)
    })

    it('labels the all-projects action as mark all as read', () => {
        const tree = renderButton({ projectIds: ['project-1', 'project-2'] })

        expect(tree.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe('mark all as read')
        expect(tree.root.findAllByType(Text).some(item => item.props.children === 'mark all as read')).toBe(true)
    })

    it('keeps the single-project action labeled as mark as read', () => {
        const tree = renderButton({ projectId: 'project-1' })

        expect(tree.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe('mark as read')
        expect(tree.root.findAllByType(Text).some(item => item.props.children === 'mark as read')).toBe(true)
    })
})
