import { isMobileVoiceCallDevice } from './assistantCallAudio'

// One owner per call, including while its composer is hidden or unmounted.
// Enumeration never requests capture or output permission on its own.
export function createCallAudioDevices(audio) {
    const mediaDevices = navigator.mediaDevices
    const mobile = isMobileVoiceCallDevice()
    const supportsInputSelection = !mobile && !!mediaDevices?.enumerateDevices
    const supportsOutputSelection = !mobile && typeof audio?.setSinkId === 'function'
    const supportsOutputPrompt = supportsOutputSelection && typeof mediaDevices?.selectAudioOutput === 'function'
    let devices = []
    let stopped = false
    let switching = false
    let revision = 0
    let notice = ''
    const refresh = async () => {
        const currentRevision = ++revision
        try {
            const listed = await mediaDevices?.enumerateDevices?.()
            if (stopped || currentRevision !== revision) return
            devices = Array.isArray(listed) ? listed : []
            notice = ''
            // A removed output must not leave the call silently pinned to it.
            if (
                supportsOutputSelection &&
                !switching &&
                audio.sinkId &&
                !devices.some(d => d.deviceId === audio.sinkId)
            ) {
                await audio.setSinkId('')
                if (!stopped) notice = 'Audio output disconnected. Using system default.'
            }
        } catch (_) {
            if (!stopped && currentRevision === revision) notice = 'Audio device list unavailable'
        }
    }
    const onDeviceChange = () => refresh()
    mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    refresh()
    return {
        refresh,
        getSnapshot: () => ({
            supportsInputSelection,
            supportsOutputSelection,
            supportsOutputPrompt,
            inputDevices: devices.filter(d => d.kind === 'audioinput' && d.deviceId),
            outputDevices: devices.filter(d => d.kind === 'audiooutput' && d.deviceId),
            outputDeviceId: audio.sinkId || '',
            notice,
        }),
        async selectOutput(deviceId) {
            if (stopped || !supportsOutputSelection || switching) throw new Error('Audio output selection unavailable')
            switching = true
            try {
                // Invoke the permission prompt synchronously from the selection gesture.
                const choice =
                    deviceId === 'choose' && supportsOutputPrompt ? await mediaDevices.selectAudioOutput() : null
                if (stopped) return
                await audio.setSinkId(choice ? choice.deviceId : deviceId)
                if (!stopped) {
                    notice = ''
                    if (choice && !devices.some(d => d.kind === 'audiooutput' && d.deviceId === choice.deviceId))
                        devices = [...devices, choice]
                }
            } finally {
                switching = false
            }
        },
        stop() {
            stopped = true
            revision++
            mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
        },
    }
}
