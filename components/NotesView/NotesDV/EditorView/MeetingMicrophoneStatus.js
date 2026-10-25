import React from 'react'
import { translate } from '../../../../i18n/TranslationService'
import './meeting-microphone-status.css'

const ERROR_KEYS = {
    storage: 'Meeting microphone storage error',
    'storage-blocked': 'Meeting microphone storage error',
    'permission-denied': 'Meeting microphone permission error',
    unauthenticated: 'Meeting microphone permission error',
    'another-tab': 'Meeting microphone another tab',
    'capture-interrupted': 'Meeting microphone interrupted',
    'resource-exhausted': 'Meeting microphone gold error',
    'note-pending': 'Meeting microphone note pending',
    offline: 'Meeting microphone offline error',
    internal: 'Meeting microphone service error',
    unavailable: 'Meeting microphone service error',
    'deadline-exceeded': 'Meeting microphone service error',
}

export default function MeetingMicrophoneStatus({ recorder, elapsedLabel }) {
    const active = ['starting', 'recording', 'stopping'].includes(recorder.phase)
    const error = recorder.captureError || recorder.error
    const statusKey =
        {
            starting: 'Microphone recording starting',
            recording: 'Meeting microphone active',
            stopping: 'Microphone recording stopping',
        }[recorder.phase] || (recorder.pending ? 'Meeting microphone pending' : 'Microphone recording stopped')
    if (!active && !recorder.pending && !error) return null
    return (
        <div role="status" className={`meeting-microphone-status${error ? ' meeting-microphone-status-error' : ''}`}>
            <div className="meeting-microphone-status-content">
                <div className="meeting-microphone-status-heading">
                    {active && <span className="meeting-microphone-status-indicator" aria-hidden="true" />}
                    <span className="meeting-microphone-status-title">
                        {translate(statusKey)} · {elapsedLabel}
                    </span>
                    {recorder.pending > 0 && (
                        <span className="meeting-microphone-status-pending">
                            {recorder.pending} {translate('Meeting microphone chunks pending')}
                        </span>
                    )}
                </div>
                <div className="meeting-microphone-status-description">
                    {error
                        ? translate(ERROR_KEYS[error] || 'Meeting microphone retry error')
                        : active
                          ? `${recorder.device || translate('Microphone')} · ${translate(recorder.signal ? 'Meeting microphone signal' : 'Meeting microphone no signal')} · ${translate('Meeting microphone keep open')}`
                          : translate('Meeting microphone recovery hint')}
                </div>
            </div>
            <div className="meeting-microphone-status-actions">
                {active && (
                    <button type="button" onClick={recorder.stop} disabled={recorder.phase === 'stopping'}>
                        {translate('Stop')}
                    </button>
                )}
                {(error || recorder.pending > 0) && (
                    <button type="button" onClick={recorder.retry}>
                        {translate('Retry')}
                    </button>
                )}
            </div>
        </div>
    )
}
