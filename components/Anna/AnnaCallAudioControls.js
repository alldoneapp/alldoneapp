import React, { useEffect, useState } from 'react'
import { translate } from '../../i18n/TranslationService'
import Icon from '../Icon'

// Keep level polling local: speaking must not rerender the transcript or provider.
export default function AnnaCallAudioControls({ call }) {
    const [snapshot, setSnapshot] = useState({})
    const [busy, setBusy] = useState('')
    const [error, setError] = useState('')
    useEffect(() => {
        const sample = () =>
            setSnapshot({
                ...call.getAudioDevicesSnapshot?.(),
                input: call.getMicrophoneSnapshot?.() || {},
                output: call.getOutputSnapshot?.() || {},
            })
        sample()
        const timer = setInterval(sample, 100)
        return () => clearInterval(timer)
    }, [call.getAudioDevicesSnapshot, call.getMicrophoneSnapshot, call.getOutputSnapshot])
    const input = snapshot.input || {}
    const output = snapshot.output || {}
    const ending = call.status === 'ending'
    const change = async (kind, deviceId) => {
        setBusy(kind)
        setError('')
        try {
            await (kind === 'input' ? call.selectMicrophone(deviceId) : call.selectAudioOutput(deviceId))
        } catch (_) {
            setError(translate(kind === 'input' ? 'Could not change microphone' : 'Could not change audio output'))
        } finally {
            setBusy('')
        }
    }
    return (
        <div className="anna-call-audio" aria-label={translate('Call audio controls')}>
            <div className="anna-call-devices">
                <AudioDevice
                    kind="input"
                    snapshot={input}
                    devices={snapshot.inputDevices || []}
                    supported={snapshot.supportsInputSelection}
                    value={input.selectedDeviceId || ''}
                    disabled={!!busy || ending}
                    onChange={id => change('input', id)}
                />
                <AudioDevice
                    kind="output"
                    snapshot={output}
                    devices={snapshot.outputDevices || []}
                    supported={snapshot.supportsOutputSelection}
                    prompt={snapshot.supportsOutputPrompt}
                    value={snapshot.outputDeviceId || ''}
                    disabled={!!busy || ending}
                    onChange={id => change('output', id)}
                />
            </div>
            {(!snapshot.supportsInputSelection || !snapshot.supportsOutputSelection) && (
                <span className="anna-call-hint">
                    {translate('Choose audio devices in your browser or system settings')}
                </span>
            )}
            {(error || snapshot.notice) && (
                <span className="anna-error" role="alert">
                    {error || translate(snapshot.notice)}
                </span>
            )}
        </div>
    )
}

function AudioDevice({ kind, snapshot, devices, supported, prompt, value, disabled, onChange }) {
    const input = kind === 'input'
    const label = translate(input ? 'Audio input' : 'Audio output')
    const defaultLabel = translate(input ? 'Automatic microphone' : 'System default audio output')
    const options = devices.filter(device => device.deviceId !== 'default' && device.deviceId !== 'communications')
    // Keep a selected device visible until enumeration catches up with a switch.
    if (value && !options.some(d => d.deviceId === value))
        options.push({ deviceId: value, label: snapshot.label || value })
    const available = snapshot.available && !snapshot.muted
    const percent = available ? Math.round(Math.sqrt(Math.max(0, Math.min(1, snapshot.level || 0))) * 100) : 0
    const meterLabel = translate(input ? 'Microphone level' : 'Audio output level')
    return (
        <div className="anna-call-device">
            <label>
                <span className="anna-call-device-label">
                    <Icon name={input ? 'mic' : 'volume-2'} size={14} color="currentColor" />
                    {label}
                </span>
                {supported ? (
                    <select
                        aria-label={label}
                        value={value}
                        disabled={disabled}
                        onChange={event => onChange(event.target.value)}
                    >
                        <option value="">
                            {input && snapshot.label ? `${defaultLabel} · ${snapshot.label}` : defaultLabel}
                        </option>
                        {options.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `${label} ${index + 1}`}
                            </option>
                        ))}
                        {prompt && <option value="choose">{translate('Choose another audio output…')}</option>}
                    </select>
                ) : (
                    <span className="anna-call-device-name">{snapshot.label || translate('System audio device')}</span>
                )}
            </label>
            <div
                className="anna-call-meter"
                role="progressbar"
                aria-label={meterLabel}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
            >
                <div style={{ width: `${percent}%` }} />
            </div>
            {!snapshot.available && <span className="anna-call-hint">{translate('Audio level unavailable')}</span>}
        </div>
    )
}
