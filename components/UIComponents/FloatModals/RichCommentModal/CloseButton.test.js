import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

import CloseButton from './CloseButton'

jest.mock('../../../Icon', () => 'Icon')

describe('RichCommentModal CloseButton', () => {
    let tree
    let underlyingButton

    beforeEach(() => {
        underlyingButton = document.createElement('button')
        document.body.appendChild(underlyingButton)
    })

    afterEach(() => {
        if (tree) {
            act(() => tree.unmount())
            tree = null
        }
        underlyingButton.remove()
    })

    const renderCloseButton = closeModal => {
        act(() => {
            tree = renderer.create(<CloseButton closeModal={closeModal} comments={[]} />)
        })
        return tree.root.findByType(TouchableOpacity)
    }

    test.each(['mouseup', 'touchend', 'pointerup'])(
        'consumes the click following a %s close instead of activating the button underneath',
        releaseEventType => {
            const closeModal = jest.fn()
            const underlyingAction = jest.fn()
            const releaseEvent = {
                nativeEvent: { type: releaseEventType },
                stopPropagation: jest.fn(),
            }
            underlyingButton.addEventListener('click', underlyingAction)
            const closeButton = renderCloseButton(closeModal)

            act(() => closeButton.props.onPress(releaseEvent))
            underlyingButton.click()

            expect(closeModal).toHaveBeenCalledTimes(1)
            expect(releaseEvent.stopPropagation).toHaveBeenCalledTimes(1)
            expect(underlyingAction).not.toHaveBeenCalled()

            underlyingButton.click()
            expect(underlyingAction).toHaveBeenCalledTimes(1)
        }
    )

    test('keeps keyboard activation working without consuming the next independent click', () => {
        const closeModal = jest.fn()
        const underlyingAction = jest.fn()
        underlyingButton.addEventListener('click', underlyingAction)
        const closeButton = renderCloseButton(closeModal)

        act(() =>
            closeButton.props.onPress({
                nativeEvent: { type: 'keyup' },
                stopPropagation: jest.fn(),
            })
        )
        underlyingButton.click()

        expect(closeModal).toHaveBeenCalledTimes(1)
        expect(underlyingAction).toHaveBeenCalledTimes(1)
    })

    test('still closes immediately with Escape', () => {
        const closeModal = jest.fn()
        renderCloseButton(closeModal)

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        })

        expect(closeModal).toHaveBeenCalledTimes(1)
    })
})
