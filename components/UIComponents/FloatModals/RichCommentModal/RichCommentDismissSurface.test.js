import React, { useState } from 'react'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'

import PopupDismissSurface from '../../PopupDismissSurface'
import { ModalShellContext } from '../../ModalShell/ModalShellContext'

jest.mock('react-native', () => {
    const React = require('react')

    class View extends React.Component {
        render() {
            return React.createElement('div', null, this.props.children)
        }
    }

    return { Platform: { OS: 'web' }, View }
})

describe('PopupDismissSurface browser interactions', () => {
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
                            <PopupDismissSurface
                                onDismiss={event => {
                                    dismiss(event)
                                    setPopupIsOpen(false)
                                }}
                            >
                                <button data-testid="inside-button" onClick={insideAction}>
                                    Popup action
                                </button>
                            </PopupDismissSurface>,
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

    it('stands down inside a bottom sheet so the sheet handle keeps its touch gesture (AT-2287)', () => {
        // In sheet mode the shell chrome (handle strip, backdrop) sits outside
        // the surface. The window-capture guard used to swallow the handle's
        // touchstart (the drag never started) and dismiss the popup on
        // release. Inside a sheet the guard must not install at all.
        const dismiss = jest.fn()
        const handleTouchStart = jest.fn()

        const Harness = () => (
            <React.Fragment>
                {ReactDOM.createPortal(
                    <ModalShellContext.Provider value={{ presentation: 'sheet' }}>
                        <div data-testid="sheet-handle" />
                        <PopupDismissSurface
                            onDismiss={event => {
                                dismiss(event)
                            }}
                        >
                            <button data-testid="inside-button">Popup action</button>
                        </PopupDismissSurface>
                    </ModalShellContext.Provider>,
                    portalRoot
                )}
            </React.Fragment>
        )

        act(() => {
            ReactDOM.render(<Harness />, appRoot)
        })
        act(() => {
            jest.runOnlyPendingTimers()
        })

        const handle = portalRoot.querySelector('[data-testid="sheet-handle"]')
        handle.addEventListener('touchstart', handleTouchStart)
        act(() => {
            dispatch(handle, 'touchstart')
            dispatch(handle, 'touchend')
        })

        expect(handleTouchStart).toHaveBeenCalledTimes(1)
        expect(dismiss).not.toHaveBeenCalled()
        expect(portalRoot.querySelector('[data-testid="inside-button"]')).not.toBeNull()
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
                            <PopupDismissSurface
                                onDismiss={event => {
                                    dismiss(event)
                                    setPopupIsOpen(false)
                                }}
                            >
                                <button data-testid="inside-button">Popup action</button>
                            </PopupDismissSurface>,
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
