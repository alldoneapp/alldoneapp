import React from 'react'
import { translate } from '../../i18n/TranslationService'
import VoiceMicrophoneStatus from './VoiceMicrophoneStatus'

export default function VoiceCallDevices({ call }) {
    const devices = call.audioDevices
    if (!devices) return null
    const disabled = devices.busy || call.status === 'ending'
    const change = async (action, value) => {
        try {
            await action(value)
        } catch (_) {
            // The call owner's device snapshot carries the error for this UI.
        }
    }
    return (
        <div style={styles.container} data-testid="voice-call-devices">
            <div style={styles.grid}>
                <label style={styles.card}>
                    <span style={styles.heading}>
                        {translate('Microphone')}
                        <VoiceMicrophoneStatus read={call.getMicrophoneSnapshot} compact />
                    </span>
                    <select
                        aria-label={translate('Call microphone')}
                        value={devices.inputId}
                        onChange={event => change(call.selectAudioInput, event.target.value)}
                        disabled={disabled || !devices.inputs.length}
                        style={styles.select}
                    >
                        <option value="">{translate('System default')}</option>
                        {devices.inputs.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `${translate('Microphone')} ${index + 1}`}
                            </option>
                        ))}
                    </select>
                </label>
                <label style={styles.card}>
                    <span style={styles.heading}>{translate('Audio output')}</span>
                    <select
                        aria-label={translate('Call audio output')}
                        value={devices.outputId}
                        onChange={event => change(call.selectAudioOutput, event.target.value)}
                        disabled={disabled || !devices.canSelectOutput}
                        style={styles.select}
                    >
                        <option value="">{translate('System default')}</option>
                        {devices.outputs.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>
                                {device.labelKey
                                    ? translate(device.labelKey)
                                    : device.label || `${translate('Audio output')} ${index + 1}`}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {devices.canRequestOutput && (
                <button
                    type="button"
                    onClick={() => change(call.requestAudioOutput)}
                    disabled={disabled}
                    style={styles.picker}
                >
                    {translate('Choose another audio output…')}
                </button>
            )}
            {!devices.canSelectOutput && (
                <p style={styles.hint}>
                    {translate('Select speaker or headphones in your device’s system audio controls.')}
                </p>
            )}
            {devices.outputFollowsInput && (
                <p style={styles.hint}>{translate('Your device links the headset microphone and audio output.')}</p>
            )}
            {devices.error && (
                <p role="alert" style={{ ...styles.hint, color: '#a12f36' }}>
                    {translate(devices.error)}
                </p>
            )}
        </div>
    )
}

const styles = {
    container: { width: '100%', minWidth: 0, marginTop: 8, fontSize: 12, color: '#4e5d78' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 },
    card: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: 4 },
    heading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 18, gap: 4 },
    select: {
        width: '100%',
        minWidth: 0,
        minHeight: 36,
        padding: '6px 4px',
        border: '1px solid #e7ecef',
        borderRadius: 8,
        background: '#fff',
        color: 'inherit',
        font: 'inherit',
        textOverflow: 'ellipsis',
    },
    hint: { margin: '6px 0 0', lineHeight: '16px', fontSize: 11 },
    picker: { padding: '6px 0', border: 0, background: 'transparent', color: '#0c66ff', font: 'inherit' },
}
