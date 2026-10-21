import React from 'react'
import { translate } from '../../../../i18n/TranslationService'

const ERROR_KEYS = {
    storage: 'Meeting microphone storage error',
    'storage-blocked': 'Meeting microphone storage error',
    'permission-denied': 'Meeting microphone permission error',
    unauthenticated: 'Meeting microphone permission error',
    'another-tab': 'Meeting microphone another tab',
    'capture-interrupted': 'Meeting microphone interrupted',
    'resource-exhausted': 'Meeting microphone gold error',
    'note-pending': 'Meeting microphone note pending',
}

export default function MeetingMicrophoneStatus({ recorder, elapsedLabel }) {
    const active = ['starting', 'recording', 'stopping'].includes(recorder.phase)
    const error = recorder.captureError || recorder.error
    const statusKey =
        {
            starting: 'Microphone recording starting',
            recording: 'Meeting microphone active',
            stopping: 'Microphone recording stopping',
        }[recorder.phase] || 'Meeting microphone pending'
    if (!active && !recorder.pending && !error) return null
    return (
        <div
            role="status"
            style={{ height: 64, background: '#FFF3D6', padding: '6px 12px', fontSize: 12, boxSizing: 'border-box' }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <strong>
                    {translate(statusKey)} · {elapsedLabel} · {recorder.pending}{' '}
                    {translate('Meeting microphone chunks pending')}
                </strong>
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
            <div>
                {error
                    ? translate(ERROR_KEYS[error] || 'Meeting microphone retry error')
                    : active
                      ? `${recorder.device || translate('Microphone')} · ${translate(recorder.signal ? 'Meeting microphone signal' : 'Meeting microphone no signal')} · ${translate('Meeting microphone keep open')}`
                      : translate('Meeting microphone recovery hint')}
            </div>
        </div>
    )
}
