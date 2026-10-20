import { primeCallAudio } from '../../components/UIComponents/assistantCallAudio'
import { createInputLevelMonitor } from '../../hooks/rambleMicCapture'
import {
    acquireVoiceMicrophone,
    createVoiceMicrophoneSelector,
} from '../../components/UIComponents/assistantVoiceMicrophone'

const button = document.createElement('button')
button.textContent = 'Test microphone selection'
document.body.append(button)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
button.onclick = async () => {
    const scenario = new URLSearchParams(location.search).get('scenario')
    const player = scenario === 'playback' ? document.createElement('audio') : null
    const primed = player ? primeCallAudio(player) : null
    const context = new AudioContext()
    await context.resume()
    if (player) {
        try {
            const unlocked = await primed
            await delay(600)
            const destination = context.createMediaStreamDestination()
            const oscillator = context.createOscillator(),
                silence = context.createGain()
            silence.gain.value = 0
            oscillator.connect(silence).connect(destination)
            oscillator.start()
            player.srcObject = destination.stream
            await player.play()
            window.result = { unlocked, playing: !player.paused }
            destination.stream.getTracks().forEach(t => t.stop())
        } catch (error) {
            window.result = { error: error.message }
        } finally {
            player.pause()
            await context.close()
        }
        return
    }
    const opened = [],
        gains = {},
        switches = []
    let selector
    let senderTrack, senderMonitor
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            enumerateDevices: async () =>
                ['builtin', 'usb'].map(deviceId => ({
                    kind: 'audioinput',
                    deviceId,
                    groupId: deviceId,
                    label: deviceId,
                })),
            getUserMedia: async ({ audio }) => {
                const id = audio.deviceId?.exact || 'builtin'
                const raw = audio.echoCancellation === false
                const destination = context.createMediaStreamDestination()
                const oscillator = context.createOscillator(),
                    gain = context.createGain()
                const loud = scenario === 'reverse' ? id === 'builtin' : id === 'usb'
                gain.gain.value = scenario === 'compatibility' && !raw ? 0 : loud ? 0.3 : 0.02
                gains[id] = gain
                oscillator.connect(gain).connect(destination)
                oscillator.start()
                const track = destination.stream.getAudioTracks()[0]
                track.getSettings = () => ({ deviceId: id, groupId: id })
                Object.defineProperty(track, 'label', { value: id })
                opened.push(track)
                return destination.stream
            },
        },
    })
    try {
        const result = await acquireVoiceMicrophone()
        const bindMutedSender = stream => {
            senderMonitor?.close()
            senderTrack?.stop()
            senderTrack = stream.getAudioTracks()[0].clone()
            senderTrack.enabled = false
            opened.push(senderTrack)
            senderMonitor = createInputLevelMonitor(new MediaStream([senderTrack]))
        }
        if (scenario === 'warmup') bindMutedSender(result.stream)
        let selected = result.deviceLabel
        let paused = false
        selector = createVoiceMicrophoneSelector({
            stream: result.stream,
            isPaused: () => paused,
            onSwitch: async stream => {
                selected = stream.getAudioTracks()[0].label
                switches.push(selected)
                if (scenario === 'warmup') bindMutedSender(stream)
            },
        })
        const expected = scenario === 'reverse' ? 'builtin' : 'usb'
        const deadline = Date.now() + 9000
        while (selected !== expected && Date.now() < deadline) await delay(100)
        if (selected !== expected)
            throw new Error(
                JSON.stringify({
                    selected,
                    switches,
                    context: context.state,
                    tracks: opened.map(t => ({ label: t.label, muted: t.muted, readyState: t.readyState })),
                })
            )
        await delay(300)
        const first = selected
        let warmedBeforeSending = false
        if (scenario === 'warmup') {
            await senderMonitor.ready
            senderMonitor.sample()
            if (senderMonitor.getLevel() !== 0 || selector.getSnapshot().level < 0.1)
                throw new Error('Startup must meter the live input while its sender clone stays silent')
            senderTrack.enabled = true
            await delay(150)
            senderMonitor.sample()
            if (senderMonitor.getLevel() < 0.1) throw new Error('Selected input did not reach sender when enabled')
            warmedBeforeSending = true
        }
        if (scenario === 'normal') {
            paused = true
            gains.builtin.gain.value = 0.5
            gains.usb.gain.value = 0.01
            await delay(4200)
            if (selected !== 'usb') throw new Error('Switched during assistant playback')
            paused = false
            await delay(1600)
        }
        selector.stop()
        senderMonitor?.close()
        senderTrack?.stop()
        window.result = {
            first,
            selected,
            switches,
            warmedBeforeSending,
            activeTracks: opened.filter(t => t.readyState === 'live').length,
        }
    } catch (error) {
        window.result = { error: error.message }
    } finally {
        selector?.stop()
        senderMonitor?.close()
        senderTrack?.stop()
        await context.close()
    }
}
