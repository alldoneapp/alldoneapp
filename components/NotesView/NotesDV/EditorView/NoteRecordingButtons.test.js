import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import NoteRecordingButtons, { formatNoteRecordingElapsed } from './NoteRecordingButtons'
import MeetingMicrophoneStatus from './MeetingMicrophoneStatus'

jest.mock('../../../Icon', () => () => null)
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))

const idle = { phase: 'idle', elapsed: 0, pending: 0 }
const props = () => ({
    microphoneVisible: true,
    screenVisible: true,
    recorder: idle,
    onMicrophone: jest.fn(),
    onScreen: jest.fn(),
})

test('one microphone action starts directly; screen/tab audio remains a separate action', () => {
    const controls = props()
    render(<NoteRecordingButtons {...controls} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Record audio' }))
    expect(controls.onMicrophone).toHaveBeenCalledTimes(1)
    expect(controls.onScreen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Screen/tab audio' }))
    expect(controls.onScreen).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Dictate')).toBeNull()
    expect(screen.queryByText('Meeting microphone')).toBeNull()
})

test('duration and Stop are visible; microphone capture blocks screen/tab recording', () => {
    const controls = { ...props(), recorder: { ...idle, phase: 'recording', elapsed: 3601 } }
    render(
        <>
            <NoteRecordingButtons {...controls} />
            <MeetingMicrophoneStatus
                recorder={{ ...controls.recorder, stop: controls.onMicrophone }}
                elapsedLabel="60:01"
            />
        </>
    )
    expect(screen.getByRole('status').textContent).toContain('Meeting microphone active · 60:01')
    fireEvent.click(screen.getByRole('button', { name: 'Stop microphone recording' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Screen/tab audio' }))
    expect(controls.onMicrophone).toHaveBeenCalledTimes(2)
    expect(controls.onScreen).not.toHaveBeenCalled()
})

test.each(['starting', 'stopping', 'unavailable'])('%s disables microphone start', phase => {
    const controls = { ...props(), recorder: { ...idle, phase } }
    render(<NoteRecordingButtons {...controls} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record audio' }))
    expect(controls.onMicrophone).not.toHaveBeenCalled()
})

test.each([{ screenStarting: true }, { screenRecording: true }, { disabled: true }])(
    'microphone cannot start while screen audio owns capture or editing is disabled: %j',
    overrides => {
        const controls = { ...props(), ...overrides }
        render(<NoteRecordingButtons {...controls} />)
        fireEvent.click(screen.getByRole('button', { name: 'Record audio' }))
        expect(controls.onMicrophone).not.toHaveBeenCalled()
    }
)

test('screen/tab Stop remains functional during screen recording', () => {
    const controls = { ...props(), screenRecording: true }
    render(<NoteRecordingButtons {...controls} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop screen audio' }))
    expect(controls.onScreen).toHaveBeenCalledTimes(1)
})

test('compact toolbar still exposes microphone and screen/tab actions by accessible name', () => {
    render(<NoteRecordingButtons {...props()} compact />)
    expect(screen.getByRole('button', { name: 'Record audio' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Screen/tab audio' })).toBeTruthy()
})

test('offline and recovery status exposes retry while keeping microphone off', () => {
    const retry = jest.fn()
    const { rerender } = render(
        <MeetingMicrophoneStatus recorder={{ ...idle, pending: 2, error: 'offline', retry }} elapsedLabel="0:03" />
    )
    expect(screen.getByRole('status').textContent).toContain('Meeting microphone pending')
    expect(screen.getByRole('status').textContent).toContain('Meeting microphone offline error')
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
    rerender(<MeetingMicrophoneStatus recorder={{ ...idle, pending: 1, retry }} elapsedLabel="0:00" />)
    expect(screen.getByRole('status').textContent).toContain('Meeting microphone recovery hint')
    rerender(<MeetingMicrophoneStatus recorder={idle} elapsedLabel="0:00" />)
    expect(screen.queryByRole('status')).toBeNull()
})

test('a server failure is distinguished from a network failure and keeps the retry action available', () => {
    const retry = jest.fn()
    render(<MeetingMicrophoneStatus recorder={{ ...idle, pending: 2, error: 'internal', retry }} elapsedLabel="0:16" />)
    expect(screen.getByRole('status').textContent).toContain('Meeting microphone service error')
    expect(screen.getByRole('status').textContent).not.toContain('Meeting microphone offline error')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
})

test('a failed microphone start does not claim transcription is pending when no audio was captured', () => {
    render(
        <MeetingMicrophoneStatus
            recorder={{ ...idle, captureError: 'permission-denied', retry: jest.fn() }}
            elapsedLabel="0:00"
        />
    )
    expect(screen.getByRole('status').textContent).toContain('Microphone recording stopped')
    expect(screen.getByRole('status').textContent).not.toContain('Meeting microphone pending')
    expect(screen.getByRole('status').textContent).not.toContain('Meeting microphone chunks pending')
})

test.each([
    ['starting', 'Microphone recording starting'],
    ['stopping', 'Microphone recording stopping'],
])('%s is distinct from active recording and shows Stop', (phase, label) => {
    render(<MeetingMicrophoneStatus recorder={{ ...idle, phase }} elapsedLabel="0:00" />)
    expect(screen.getByRole('status').textContent).toContain(label)
    expect(screen.getByRole('button', { name: 'Stop' }).disabled).toBe(phase === 'stopping')
})

test('elapsed label has no five-minute or one-hour rollover', () => {
    expect(formatNoteRecordingElapsed(5)).toBe('0:05')
    expect(formatNoteRecordingElapsed(301)).toBe('5:01')
    expect(formatNoteRecordingElapsed(3601)).toBe('60:01')
})
