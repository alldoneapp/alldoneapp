import React, { useState } from 'react'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'

import RichCommentDismissSurface from './RichCommentDismissSurface'

jest.mock('react-native', () => {
    const React = require('react')

    class View extends React.Component {
        render() {
            return React.createElement('div', null, this.props.children)
        }
    }

    return { Platform: { OS: 'web' }, View }
})

describe('RichCommentDismissSurface browser interactions', () => {
    let appRoot
    let portalRoot

    beforeEach(() => {
        jest.useFakeTimers()
        appRoot = document.createElement('div')
        portalRoot = document.createElement('div')
        document.body.appendChild(appRoot)
        document.body.appendChild(portalRoot)
    })

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(appRoot)
        })
        appRoot.remove()
        portalRoot.remove()
        jest.runOnlyPendingTimers()
        jest.useRealTimers()
    })

    const dispatch = (target, type) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        target.dispatchEvent(event)
        return event
    }

    const renderHarness = ({ dismiss, insideAction, underlyingAction }) => {
        const Harness = () => {
            const [popupIsOpen, setPopupIsOpen] = useState(true)

            return (
                <React.Fragment>
                    <button data-testid="underlying-button" onClick={underlyingAction}>
                        Underlying action
                    </button>
                    {popupIsOpen &&
                        ReactDOM.createPortal(
                            <RichCommentDismissSurface
                                onDismiss={event => {
                                    dismiss(event)
                                    setPopupIsOpen(false)
                                }}
                            >
                                <button data-testid="inside-button" onClick={insideAction}>
                                    Popup action
                                </button>
                            </RichCommentDismissSurface>,
                            portalRoot
                        )}
                </React.Fragment>
            )
        }

        act(() => {
            ReactDOM.render(<Harness />, appRoot)
        })
        act(() => {
            jest.runOnlyPendingTimers()
        })
    }

    test.each([
        ['mouse', ['mousedown', 'mouseup', 'click']],
        ['pointer with compatibility mouse events', ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']],
        ['touch with emulated mouse events', ['touchstart', 'touchend', 'mousedown', 'mouseup', 'click']],
    ])('consumes a real rendered outside %s sequence before the underlying React handler', (name, eventTypes) => {
        const dismiss = jest.fn()
        const insideAction = jest.fn()
        const underlyingAction = jest.fn()
        const underlyingNativeEvent = jest.fn()
        renderHarness({ dismiss, insideAction, underlyingAction })

        const underlyingButton = appRoot.querySelector('[data-testid="underlying-button"]')
        eventTypes.forEach(type => underlyingButton.addEventListener(type, underlyingNativeEvent))

        let clickEvent
        act(() => {
            eventTypes.forEach(type => {
                const event = dispatch(underlyingButton, type)
                if (type === 'click') clickEvent = event
            })
        })

        expect(dismiss).toHaveBeenCalledTimes(1)
        expect(clickEvent.defaultPrevented).toBe(true)
        expect(underlyingNativeEvent).not.toHaveBeenCalled()
        expect(underlyingAction).not.toHaveBeenCalled()
        expect(portalRoot.childElementCount).toBe(0)

        act(() => underlyingButton.click())
        expect(underlyingAction).toHaveBeenCalledTimes(1)
    })

    it('preserves interaction inside the rendered popup', () => {
        const dismiss = jest.fn()
        const insideAction = jest.fn()
        renderHarness({ dismiss, insideAction, underlyingAction: jest.fn() })

        const insideButton = portalRoot.querySelector('[data-testid="inside-button"]')
        act(() => {
            dispatch(insideButton, 'mousedown')
            dispatch(insideButton, 'mouseup')
            insideButton.click()
        })

        expect(dismiss).not.toHaveBeenCalled()
        expect(insideAction).toHaveBeenCalledTimes(1)
    })

    it('does not treat the mobile compatibility events from the opening tap as an outside dismissal', () => {
        const dismiss = jest.fn()
        const underlyingAction = jest.fn()

        const Harness = () => {
            const [popupIsOpen, setPopupIsOpen] = useState(false)

            return (
                <React.Fragment>
                    <button data-testid="open-button" onTouchEnd={() => setPopupIsOpen(true)}>
                        Open comments
                    </button>
                    {popupIsOpen &&
                        ReactDOM.createPortal(
                            <RichCommentDismissSurface
                                onDismiss={event => {
                                    dismiss(event)
                                    setPopupIsOpen(false)
                                }}
                            >
                                <button data-testid="inside-button">Popup action</button>
                            </RichCommentDismissSurface>,
                            portalRoot
                        )}
                    <button data-testid="underlying-button" onClick={underlyingAction}>
                        Underlying action
                    </button>
                </React.Fragment>
            )
        }

        act(() => {
            ReactDOM.render(<Harness />, appRoot)
        })

        const openButton = appRoot.querySelector('[data-testid="open-button"]')
        act(() => {
            dispatch(openButton, 'touchstart')
            dispatch(openButton, 'touchend')
            dispatch(openButton, 'mousedown')
            dispatch(openButton, 'mouseup')
            dispatch(openButton, 'click')
        })

        expect(dismiss).not.toHaveBeenCalled()
        expect(portalRoot.querySelector('[data-testid="inside-button"]')).not.toBeNull()

        act(() => {
            jest.runOnlyPendingTimers()
        })
        const underlyingButton = appRoot.querySelector('[data-testid="underlying-button"]')
        act(() => {
            dispatch(underlyingButton, 'mousedown')
            dispatch(underlyingButton, 'mouseup')
            dispatch(underlyingButton, 'click')
        })

        expect(dismiss).toHaveBeenCalledTimes(1)
        expect(underlyingAction).not.toHaveBeenCalled()
        expect(portalRoot.childElementCount).toBe(0)
    })
})
