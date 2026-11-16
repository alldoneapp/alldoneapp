import React, { useEffect, useId, useRef, useState } from 'react'
import { translate } from '../../i18n/TranslationService'
import Icon from '../Icon'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import useModalSizing from '../../hooks/useModalSizing'
import useEscapeKey from '../../hooks/useEscapeKey'

// Keep level polling local: speaking must not rerender the transcript or provider.
// AT-3038: the main app's floating call panel reuses these controls outside AnnaShell. It passes
// the assistant's name as `label`, and raises the settings popover above its own fixed layer
// (`settingsZIndex`) instead of using a bottom sheet, which would open underneath the panel.
export default function AnnaCallAudioControls({
    call,
    seconds = 0,
    label = null,
    settingsZIndex = 10000,
    settingsUseSheet = true,
    children,
}) {
    const [snapshot, setSnapshot] = useState({})
    const [busy, setBusy] = useState('')
    const [error, setError] = useState('')
    const [settingsOpen, setSettingsOpen] = useState(false)
    const settingsButton = useRef(null)
    const settingsId = useId()
    const { width, maxHeight } = useModalSizing({ size: 'S' })
    const closeSettings = () => {
        setSettingsOpen(false)
        settingsButton.current?.focus({ preventScroll: true })
    }
    useEscapeKey(closeSettings, { enabled: settingsOpen })
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
    const notice = error || (snapshot.notice && translate(snapshot.notice))
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
            <div className="anna-call-summary">
                <div className="anna-call-levels">
                    <AudioLevel kind="input" snapshot={{ ...input, muted: call.microphoneMuted || input.muted }} />
                    <AudioLevel kind="output" snapshot={output} />
                </div>
                <div className="anna-call-duration">
                    <span>{label || translate('Voice call in progress')}</span>
                    <span className="anna-call-clock" role="timer">
                        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                    </span>
                </div>
            </div>
            <div className="anna-composer-toolbar">
                <AppPopover
                    isOpen={settingsOpen}
                    onClickOutside={closeSettings}
                    position={['top', 'bottom']}
                    align="start"
                    padding={8}
                    useSheet={settingsUseSheet}
                    containerStyle={{ zIndex: settingsZIndex }}
                    content={
                        <div
                            id={settingsId}
                            className="anna-call-settings"
                            role="dialog"
                            aria-label={translate('Audio settings')}
                            style={{ width, maxHeight }}
                        >
                            <div className="anna-call-settings-heading">
                                <strong>{translate('Audio settings')}</strong>
                                <button type="button" autoFocus aria-label={translate('Close')} onClick={closeSettings}>
                                    <Icon name="x" size={18} color="currentColor" />
                                </button>
                            </div>
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
                            {snapshot.outputFollowsInput && (
                                <span className="anna-call-hint">
                                    {translate('Your device links the headset microphone and audio output.')}
                                </span>
                            )}
                            {(!snapshot.supportsInputSelection || !snapshot.supportsOutputSelection) && (
                                <span className="anna-call-hint">
                                    {translate('Choose audio devices in your browser or system settings')}
                                </span>
                            )}
                            {notice && <span className="anna-call-settings-error">{notice}</span>}
                        </div>
                    }
                >
                    <button
                        ref={settingsButton}
                        type="button"
                        className={`anna-voice-button anna-call-settings-button${notice ? ' anna-call-settings-warning' : ''}`}
                        aria-label={translate('Audio settings')}
                        title={notice || translate('Audio settings')}
                        aria-haspopup="dialog"
                        aria-expanded={settingsOpen}
                        aria-controls={settingsOpen ? settingsId : undefined}
                        onClick={() => setSettingsOpen(open => !open)}
                    >
                        <Icon name="sliders" size={18} color="currentColor" />
                        {notice && <span className="anna-call-notice-dot" />}
                    </button>
                </AppPopover>
                <div className="anna-composer-actions">{children}</div>
            </div>
            {notice && (
                <span className="anna-call-sr-only" role="alert">
                    {notice}
                </span>
            )}
        </div>
    )
}

// Mute, "enable call audio" and hang up, shared by the Assistant Mode composer and the main
// app's floating call panel so both calls offer the same buttons in the same order.
export function AnnaCallActions({ call, endLabel, onEnd }) {
    const ending = call.status === 'ending'
    return (
        <>
            <button
                type="button"
                className="anna-voice-button"
                disabled={ending}
                aria-label={translate(call.microphoneMuted ? 'Unmute assistant call' : 'Mute assistant call')}
                aria-pressed={!!call.microphoneMuted}
                onClick={() => call.toggleMicrophoneMuted()}
                onKeyDown={event => {
                    if (event.key !== 'Enter') return
                    // The shared editor cancels Enter at document level.
                    event.preventDefault()
                    event.stopPropagation()
                    if (!event.repeat) event.currentTarget.click()
                }}
            >
                <Icon name={call.microphoneMuted ? 'mic-off' : 'mic'} size={20} color="currentColor" />
            </button>
            {call.needsAudioPlayback && (
                <button
                    type="button"
                    className="anna-voice-button"
                    aria-label={translate('Enable call audio')}
                    title={translate('Enable call audio')}
                    onClick={() => call.playCallAudio()}
                >
                    <Icon name="volume-2" size={20} color="currentColor" />
                </button>
            )}
            <button
                type="button"
                className="anna-voice-button anna-voice-active"
                aria-label={endLabel}
                title={endLabel}
                disabled={ending}
                onClick={onEnd}
            >
                <Icon name="phone-off" size={20} color="currentColor" />
            </button>
        </>
    )
}

function AudioLevel({ kind, snapshot }) {
    const input = kind === 'input'
    const available = snapshot.available && !snapshot.muted
    const level = Number.isFinite(snapshot.level) ? snapshot.level : 0
    const percent = available ? Math.round(Math.sqrt(Math.max(0, Math.min(1, level))) * 100) : 0
    const label = translate(input ? 'Microphone level' : 'Audio output level')
    const state = snapshot.muted
        ? translate('Microphone muted')
        : !snapshot.available
          ? translate('Audio level unavailable')
          : `${percent}%`
    return (
        <div className={`anna-call-level anna-call-level-${kind}`} title={`${label} · ${state}`}>
            <Icon name={input ? (snapshot.muted ? 'mic-off' : 'mic') : 'volume-2'} size={16} color="currentColor" />
            <div
                className="anna-call-meter"
                role="progressbar"
                aria-label={label}
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={state}
            >
                <div style={{ height: `${percent}%` }} />
            </div>
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
                                {device.label ||
                                    (device.labelKey && translate(device.labelKey)) ||
                                    `${label} ${index + 1}`}
                            </option>
                        ))}
                        {prompt && <option value="choose">{translate('Choose another audio output…')}</option>}
                    </select>
                ) : (
                    <span className="anna-call-device-name">{snapshot.label || translate('System audio device')}</span>
                )}
            </label>
            {!snapshot.available && <span className="anna-call-hint">{translate('Audio level unavailable')}</span>}
        </div>
    )
}
