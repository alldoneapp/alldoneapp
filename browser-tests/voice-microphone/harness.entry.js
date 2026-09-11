import { acquireVoiceMicrophone } from '../../components/UIComponents/assistantVoiceMicrophone'

const button = document.createElement('button')
button.textContent = 'Test microphone selection'
document.body.append(button)
button.onclick = async () => {
    const context = new AudioContext()
    await context.resume()
    const scenario = new URLSearchParams(location.search).get('scenario')
    const opened = []
    // Synthetic inputs only: never ask for or use the machine's microphone.
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
                const oscillator = context.createOscillator()
                const gain = context.createGain()
                const loud = scenario === 'reverse' ? id === 'builtin' : id === 'usb'
                gain.gain.value = scenario === 'compatibility' && !raw ? 0 : loud ? 0.3 : 0.02
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
        window.result = {
            selected: result.deviceLabel,
            measured: result.measured,
            hasSignal: result.hasSignal,
            compatibilityMode: result.compatibilityMode,
            activeTracks: opened.filter(track => track.readyState === 'live').length,
        }
        result.stream.getTracks().forEach(track => track.stop())
    } catch (error) {
        window.result = { error: error.message }
    } finally {
        await context.close()
    }
}
