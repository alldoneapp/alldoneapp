import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('../../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({ width: 320 }) }))
jest.mock('../../../../UIComponents/FloatModals/DueDateModal/Header', () => 'Header')
jest.mock('react-hot-keys', () => ({ children }) => children)
jest.mock('../../../../UIControls/Button', () => {
    const React = require('react')
    const { TouchableOpacity } = require('react-native')
    return props => React.createElement(TouchableOpacity, props)
})

import Button from '../../../../UIControls/Button'
import EmailTaskCompletionModal from './EmailTaskCompletionModal'

describe('EmailTaskCompletionModal', () => {
    test('offers both completion choices and ignores a rapid double submission', () => {
        const onComplete = jest.fn()
        const tree = renderer.create(
            <EmailTaskCompletionModal closePopover={jest.fn()} onComplete={onComplete} submitting={false} />
        )
        const archiveButton = tree.root.findByProps({ testID: 'email-task-complete-and-archive' })
        const completeOnlyButton = tree.root.findByProps({ testID: 'email-task-complete-only' })

        act(() => {
            archiveButton.props.onPress()
            archiveButton.props.onPress()
            completeOnlyButton.props.onPress()
        })

        expect(onComplete).toHaveBeenCalledTimes(1)
        expect(onComplete).toHaveBeenCalledWith(true)
        expect(tree.root.findAllByType(Button)).toHaveLength(2)
        tree.unmount()
    })

    test('passes the complete-only choice without requesting an archive', () => {
        const onComplete = jest.fn()
        const tree = renderer.create(
            <EmailTaskCompletionModal closePopover={jest.fn()} onComplete={onComplete} submitting={false} />
        )

        act(() => tree.root.findByProps({ testID: 'email-task-complete-only' }).props.onPress())

        expect(onComplete).toHaveBeenCalledWith(false)
        tree.unmount()
    })

    test('archives when Enter is pressed and consumes repeated key events', () => {
        const onComplete = jest.fn()
        const propagatedKeyDown = jest.fn()
        let tree
        act(() => {
            tree = renderer.create(
                <EmailTaskCompletionModal closePopover={jest.fn()} onComplete={onComplete} submitting={false} />
            )
        })
        document.addEventListener('keydown', propagatedKeyDown)
        const firstEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        const repeatedEnter = new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
            repeat: true,
        })

        act(() => {
            document.dispatchEvent(firstEnter)
            document.dispatchEvent(repeatedEnter)
        })

        expect(onComplete).toHaveBeenCalledTimes(1)
        expect(onComplete).toHaveBeenCalledWith(true)
        expect(firstEnter.defaultPrevented).toBe(true)
        expect(propagatedKeyDown).not.toHaveBeenCalled()

        document.removeEventListener('keydown', propagatedKeyDown)
        tree.unmount()
    })
})
