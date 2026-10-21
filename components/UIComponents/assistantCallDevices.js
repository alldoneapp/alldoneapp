import { subscribePageVisible } from '../../utils/appResume'

const aliases = new Set(['', 'default', 'communications'])
const isHeadset = device =>
    !isCommunicationRoute(device) && /airpods|bluetooth|headset|headphone|earbuds|earphones|buds\b/i.test(device.label)
export const isCommunicationRoute = device => /speakerphone|headset earpiece|earpiece|speaker phone/i.test(device.label)

export const emptyCallDevices = () => ({
    inputs: [],
    outputs: [],
    inputId: '',
    outputId: '',
    inputLabel: '',
    native: false,
    canSelectOutput: false,
    canRequestOutput: false,
    outputFollowsInput: false,
    busy: false,
    error: '',
    notice: '',
})

// Inventory changes identify a headset. A quiet microphone is not evidence that
// AirPods connected. In particular, never open unused phone inputs to meter them:
// mobile capture and playback share a communication route.
export function createCallDeviceController({
    audio,
    getInput,
    selectInput,
    onChange,
    nativePlugin = null,
    mediaDevices = navigator.mediaDevices,
    isHidden = () => document.visibilityState === 'hidden',
    throwErrors = false,
}) {
    let state = { ...emptyCallDevices(), native: !!nativePlugin }
    let stopped = false
    let refreshing = false
    const refreshWaiters = []
    let initialized = false
    let previousDevices = []
    let nativeListener
    let fingerprint = ''
    let requestedRefresh = false
    let revision = 0
    const grantedOutputs = new Map()
    const publish = patch => {
        if (stopped) return
        state = { ...state, ...patch }
        const next = JSON.stringify(state)
        if (next === fingerprint) return
        fingerprint = next
        onChange(state)
    }
    const applyNative = devices => {
        if (!devices || stopped) return
        publish({
            inputs: devices.inputs || [],
            outputs: devices.outputs || [],
            inputId: devices.inputId || '',
            outputId: devices.outputId || '',
            inputLabel: devices.inputLabel || '',
            canSelectOutput: true,
            outputFollowsInput: devices.outputFollowsInput === true,
        })
    }
    const applyInput = async id => {
        if (stopped || isHidden()) throw new Error('Call audio unavailable')
        if (nativePlugin) applyNative(await nativePlugin.setInput({ deviceId: id }))
        else await selectInput(id)
    }
    const applyOutput = async id => {
        if (stopped || isHidden()) throw new Error('Call audio unavailable')
        if (nativePlugin) applyNative(await nativePlugin.setOutput({ deviceId: id }))
        else if (audio.setSinkId) await audio.setSinkId(id)
        else {
            // Chrome on some Android devices exposes communication outputs as
            // inputs. Selecting one replaces the transmitted RTC track in place.
            const route = state.outputs.find(device => device.deviceId === id)
            if (id && !route?.inputDeviceId) throw new Error('System output selection required')
            await applyInput(route?.inputDeviceId || '')
        }
        if (!stopped && !nativePlugin) publish({ outputId: id })
    }
    const refresh = async () => {
        if (stopped || isHidden()) return
        if (refreshing) {
            requestedRefresh = true
            return new Promise(resolve => refreshWaiters.push(resolve))
        }
        if (state.busy) {
            requestedRefresh = true
            return
        }
        refreshing = true
        const readRevision = revision
        try {
            if (nativePlugin) {
                const devices = await nativePlugin.getAudioDevices()
                if (readRevision === revision) applyNative(devices)
                else requestedRefresh = true
                return
            }
            if (!mediaDevices?.enumerateDevices) return
            const inventory = await mediaDevices.enumerateDevices()
            if (stopped || isHidden()) return
            if (readRevision !== revision) {
                requestedRefresh = true
                return
            }
            const devices = inventory
                .filter(device => ['audioinput', 'audiooutput'].includes(device.kind) && device.deviceId)
                .map(({ deviceId, kind, label, groupId }) => ({ deviceId, kind, label, groupId }))
            for (const [id, grant] of grantedOutputs) {
                if (devices.some(device => device.kind === 'audiooutput' && device.deviceId === id)) grant.seen = true
                else if (grant.seen) grantedOutputs.delete(id)
                else devices.push(grant.device)
            }
            const inputs = devices.filter(device => device.kind === 'audioinput' && !aliases.has(device.deviceId))
            const outputs = audio.setSinkId
                ? devices.filter(device => device.kind === 'audiooutput' && !aliases.has(device.deviceId))
                : inputs
                      .filter(device => isCommunicationRoute(device) || isHeadset(device))
                      .map(device => ({
                          ...device,
                          inputDeviceId: device.deviceId,
                      }))
            const input = getInput() || {}
            const previous = previousDevices
            previousDevices = devices
            publish({
                inputs,
                outputs,
                inputId: inputs.some(device => device.deviceId === input.deviceId) ? input.deviceId : '',
                inputLabel: input.label || '',
                outputId: audio.setSinkId
                    ? audio.sinkId || ''
                    : outputs.find(device => device.inputDeviceId === input.deviceId)?.deviceId || '',
                canSelectOutput: !!audio.setSinkId || outputs.length > 0,
                canRequestOutput: !!audio.setSinkId && !!mediaDevices.selectAudioOutput,
                outputFollowsInput: !audio.setSinkId && outputs.length > 0,
            })
            if (!initialized) {
                initialized = true
                return
            }
            const added = devices.filter(
                device =>
                    !aliases.has(device.deviceId) &&
                    isHeadset(device) &&
                    !previous.some(old => old.kind === device.kind && old.deviceId === device.deviceId)
            )
            const newInput = added.find(device => device.kind === 'audioinput')
            const newOutput = added.find(device => device.kind === 'audiooutput')
            const lostInput =
                input.deviceId &&
                previous.some(device => device.kind === 'audioinput' && device.deviceId === input.deviceId) &&
                !inputs.some(device => device.deviceId === input.deviceId)
            const lostOutput = state.outputId && !outputs.some(device => device.deviceId === state.outputId)
            if (newInput || newOutput || lostInput || lostOutput) {
                publish({ busy: true, error: '' })
                try {
                    if (newInput || lostInput) await applyInput(newInput?.deviceId || '')
                    if (newOutput && audio.setSinkId) await applyOutput(newOutput.deviceId)
                    else if (newInput && !audio.setSinkId) publish({ outputId: newInput.deviceId })
                    else if (lostOutput) {
                        await applyOutput('')
                        publish({ notice: 'Audio output disconnected. Using system default.' })
                    }
                } catch (_) {
                    publish({ error: 'Could not switch call audio device' })
                } finally {
                    publish({ busy: false })
                    requestedRefresh = true
                }
            }
        } catch (_) {
            // A failed inventory read is unknown, not an empty authoritative list.
            publish({ notice: 'Audio device list unavailable' })
        } finally {
            refreshing = false
            if (requestedRefresh && !stopped) {
                requestedRefresh = false
                await refresh()
            }
            refreshWaiters.splice(0).forEach(resolve => resolve())
        }
    }
    const change = async action => {
        if (stopped || state.busy || isHidden()) return
        revision++
        publish({ busy: true, error: '', notice: '' })
        try {
            await action()
        } catch (error) {
            if (error?.name !== 'AbortError') publish({ error: 'Could not switch call audio device' })
            if (throwErrors && !stopped) throw error
        } finally {
            publish({ busy: false })
            refresh()
        }
    }
    const deviceChanged = () => refresh()
    if (nativePlugin?.addListener) {
        Promise.resolve(nativePlugin.addListener('audioDevicesChanged', () => refresh()))
            .then(listener => {
                if (stopped) listener.remove()
                else nativeListener = listener
            })
            .catch(() => {})
    } else mediaDevices?.addEventListener?.('devicechange', deviceChanged)
    const unsubscribe = subscribePageVisible(deviceChanged)
    const timer = setInterval(deviceChanged, 2000)
    refresh()
    return {
        refresh: deviceChanged,
        selectInput: id => change(() => applyInput(id)),
        selectOutput: id => change(() => applyOutput(id)),
        requestOutput: () =>
            change(async () => {
                // Call directly from the button gesture: the picker requires activation.
                const device = await mediaDevices.selectAudioOutput()
                if (!stopped) {
                    await applyOutput(device.deviceId)
                    grantedOutputs.set(device.deviceId, { device, seen: false })
                }
            }),
        stop() {
            stopped = true
            clearInterval(timer)
            unsubscribe?.()
            mediaDevices?.removeEventListener?.('devicechange', deviceChanged)
            nativeListener?.remove()
            refreshWaiters.splice(0).forEach(resolve => resolve())
        },
    }
}

// Keep the shared call owner's snapshot API used by the compact Assistant Mode
// controls. One controller owns routing on desktop, mobile and the native shell.
export function createCallAudioDevices(audio, options = {}) {
    const mediaDevices = options.mediaDevices || navigator.mediaDevices
    let state = {
        ...emptyCallDevices(),
        canSelectOutput: !!options.nativePlugin || typeof audio?.setSinkId === 'function',
        canRequestOutput:
            typeof audio?.setSinkId === 'function' && typeof mediaDevices?.selectAudioOutput === 'function',
    }
    let stopped = false
    const controller = createCallDeviceController({
        audio,
        getInput: () => ({}),
        selectInput: async () => {},
        ...options,
        throwErrors: true,
        onChange: next => {
            state = next
            options.onChange?.(next)
        },
    })
    return {
        refresh: controller.refresh,
        getSnapshot: () => ({
            ...state,
            supportsInputSelection: !!options.nativePlugin || typeof mediaDevices?.enumerateDevices === 'function',
            supportsOutputSelection: state.canSelectOutput,
            supportsOutputPrompt: state.canRequestOutput,
            inputDevices: state.inputs,
            outputDevices: state.outputs,
            outputDeviceId: state.outputId,
            notice: state.error || state.notice,
        }),
        selectInput: controller.selectInput,
        async selectOutput(id) {
            if (stopped || !state.canSelectOutput) throw new Error('Audio output selection unavailable')
            return id === 'choose' ? controller.requestOutput() : controller.selectOutput(id)
        },
        stop() {
            stopped = true
            controller.stop()
        },
    }
}
