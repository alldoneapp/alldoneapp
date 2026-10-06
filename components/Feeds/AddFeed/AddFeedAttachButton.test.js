import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import AddFeedAttachButton from './AddFeedAttachButton'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'

const mockDispatch = jest.fn()
let mockShortcutProps
jest.mock('react-native', () => jest.requireActual('react-native-web'))
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: () => false }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../Premium/PremiumHelper', () => ({ checkIsLimitedByTraffic: jest.fn(() => false) }))
jest.mock('../../../redux/actions', () => ({
    showFloatPopup: () => ({ type: 'show-popup' }),
    hideFloatPopup: () => ({ type: 'hide-popup' }),
}))
jest.mock('../../../utils/HelperFunctions', () => ({
    execShortcutFn: (ref, open) => open(),
    applyPopoverWidth: () => ({}),
}))
jest.mock('../../../utils/useWindowSize', () => () => [390, 664])
jest.mock('../../MyPlatform', () => ({ isDesktop: true }))
jest.mock('../../Icon', () => () => null)
jest.mock('../../UIControls/CustomScrollView', () => {
    return ({ children }) => <div>{children}</div>
})
jest.mock('../../UIControls/Button', () => {
    const React = require('react')
    return React.forwardRef(({ onPress, disabled, accessibilityLabel, accessibilityState, icon, buttonStyle }, ref) => (
        <button
            ref={ref}
            onClick={onPress}
            disabled={disabled}
            aria-label={accessibilityLabel}
            aria-expanded={accessibilityState.expanded}
            data-icon={icon}
            style={buttonStyle}
        />
    ))
})
jest.mock('react-hot-keys', () => ({ children, ...props }) => {
    mockShortcutProps = props
    return children
})
// Keep the actual selector and file-picker flow; the popup shell is covered by its own suites.
jest.mock('../../UIComponents/ModalShell/AppPopover', () => ({ children, content, isOpen, onClickOutside }) => (
    <div>
        {children}
        {isOpen && (
            <div role="dialog">
                {content}
                <button onClick={onClickOutside}>Outside</button>
            </div>
        )}
    </div>
))
jest.mock('../../MediaBar/RecordVideo/RecordVideo', () => ({ projectId, setVideoToExternalParent }) => (
    <button onClick={() => setVideoToExternalParent(new File(['video'], 'my video.mp4'))}>
        Finish video in {projectId}
    </button>
))
jest.mock('../../MediaBar/ScreenRecording/ScreenRecording', () => ({ projectId, closeModal }) => (
    <button onClick={closeModal}>Stop screen recording in {projectId}</button>
))
jest.mock('../../MediaBar/ScreenRecording/NotAvailableScreenRecording', () => () => null)

describe('shared chat attachment menu in the assistant composer (AT-2699)', () => {
    let addAttachmentTag

    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()
        checkIsLimitedByTraffic.mockReturnValue(false)
        URL.createObjectURL = jest.fn(file => `blob:${file.name}`)
        addAttachmentTag = jest.fn()
    })

    afterEach(() => {
        act(() => jest.runOnlyPendingTimers())
        jest.useRealTimers()
    })

    const mount = props =>
        render(
            <AddFeedAttachButton
                compact
                projectId="conversation-project"
                addAttachmentTag={addAttachmentTag}
                {...props}
            />
        )
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Select kind of file to add' }))

    it('shows an accessible compact plus and the same file, video and screen actions', () => {
        mount()
        const button = screen.getByRole('button', { name: 'Select kind of file to add' })
        expect(button.dataset.icon).toBe('plus')
        expect(button.style.width).toBe('24px')
        expect(button.getAttribute('aria-expanded')).toBe('false')
        open()
        expect(button.getAttribute('aria-expanded')).toBe('true')
        expect(screen.getByText('File or image')).toBeTruthy()
        expect(screen.getByText('Record a video')).toBeTruthy()
        expect(screen.getByText('Screen recording')).toBeTruthy()
        expect(checkIsLimitedByTraffic).toHaveBeenCalledWith('conversation-project')
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'show-popup' })
    })

    it('passes a selected file to the editor callback and closes the popup', () => {
        mount()
        open()
        fireEvent.click(screen.getByText('File or image'))
        fireEvent.change(document.getElementById('file-input'), {
            target: { files: [new File(['pdf'], 'my document.pdf', { type: 'application/pdf' })] },
        })
        expect(addAttachmentTag).toHaveBeenCalledWith('my_document.pdf', 'blob:my document.pdf')
        act(() => jest.runOnlyPendingTimers())
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'hide-popup' })
    })

    it('uses the same editor callback for recorded video', () => {
        mount()
        open()
        fireEvent.click(screen.getByText('Record a video'))
        fireEvent.click(screen.getByText('Finish video in conversation-project'))
        expect(addAttachmentTag).toHaveBeenCalledWith('my_video.mp4', 'blob:my video.mp4')
    })

    it('opens screen recording for the conversation project', () => {
        mount()
        open()
        fireEvent.click(screen.getByText('Screen recording'))
        fireEvent.click(screen.getByText('Stop screen recording in conversation-project'))
        expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('honours the existing project traffic quota', () => {
        mount()
        checkIsLimitedByTraffic.mockReturnValue(true)
        open()
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('cannot open a disabled composer by click or shortcut', () => {
        mount({ isDisabled: true })
        open()
        expect(mockShortcutProps.disabled).toBe(true)
        act(() => mockShortcutProps.onKeyDown('alt+U', {}))
        expect(checkIsLimitedByTraffic).not.toHaveBeenCalled()
        expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('supports the existing Alt+U shortcut and Escape dismissal', () => {
        mount()
        expect(mockShortcutProps.keyName).toBe('alt+U')
        act(() => mockShortcutProps.onKeyDown('alt+U', {}))
        expect(screen.getByRole('dialog')).toBeTruthy()
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('keeps the normal chat button appearance by default', () => {
        mount({ compact: false, smallScreen: true })
        expect(screen.getByRole('button').dataset.icon).toBe('folder-plus')
    })
})
