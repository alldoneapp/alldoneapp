/**
 * @jest-environment jsdom
 *
 * AT-2496 — an assistant voice call must survive the app going to the
 * background. The REAL component is driven against a fake RTCPeerConnection /
 * getUserMedia so the wiring under test is the component's own: the
 * visibility-dependent disconnect grace, the "a hidden page never reopens the
 * microphone" rule, the native audio-session hand-off on the iOS shell, and the
 * media-session hangup action.
 */
import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import {
    HIDDEN_DISCONNECT_GRACE_MS,
    RETURN_MIC_SETTLE_MS,
    VISIBLE_DISCONNECT_GRACE_MS,
} from './assistantCallBackground'

jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn() }))
jest.mock('../../utils/assistantHelper', () => ({ createBotQuickTopic: jest.fn() }))
jest.mock('../UIControls/Button', () => 'Button')
jest.mock('../Icon', () => 'Icon')
jest.mock('./Spinner', () => 'Spinner')
jest.mock(
    'react-tiny-popover',
    () =>
        ({ children }) =>
            children
)
jest.mock('./ModalShell/BottomSheet', () => () => null)

const { runHttpsCallableFunction } = require('../../utils/backends/firestore')
const { createBotQuickTopic } = require('../../utils/assistantHelper')
const AssistantVoiceCallButton = require('./AssistantVoiceCallButton').default
const { AssistantVoiceCallProvider } = require('./AssistantVoiceCallProvider')
const AppPopover = require('./ModalShell/AppPopover').default

const MIC_HEALTH_POLL_MS = 4000

class FakePeerConnection {
    constructor() {
        FakePeerConnection.instances.push(this)
        this.connectionState = 'new'
        this.iceGatheringState = 'complete'
        this.localDescription = null
        this.senders = []
        this.closed = false
        this.statsReports = []
    }
    addTrack(track) {
        const sender = {
            track,
            replaceTrack: jest.fn(async newTrack => {
                sender.track = newTrack
            }),
        }
        this.senders.push(sender)
    }
    getSenders() {
        return this.senders
    }
    createDataChannel() {
        this.channel = { readyState: 'open', send: jest.fn(), close: jest.fn() }
        return this.channel
    }
    async createOffer() {
        return { type: 'offer', sdp: 'offer-sdp' }
    }
    async setLocalDescription(description) {
        this.localDescription = description
    }
    async setRemoteDescription() {
        if (FakePeerConnection.liveStartupEvents) {
            this.channel.onmessage({ data: JSON.stringify({ type: 'session.started' }) })
            if (FakePeerConnection.liveStartupEvents !== 'started-only')
                this.channel.onmessage({
                    data: JSON.stringify({
                        type: 'session.instructions.appended',
                        client_event_id: 'alldone_live_ready',
                    }),
                })
        }
    }
    async getStats() {
        return this.statsReports
    }
    close() {
        this.closed = true
        this.connectionState = 'closed'
    }
    addEventListener() {}
    removeEventListener() {}
    setConnectionState(state) {
        this.connectionState = state
        if (this.onconnectionstatechange) this.onconnectionstatechange()
    }
}
FakePeerConnection.instances = []

const makeTrack = () => {
    const track = { kind: 'audio', readyState: 'live', muted: false, enabled: true, label: 'MacBook Microphone' }
    track.stop = jest.fn(() => {
        track.readyState = 'ended'
    })
    track.clone = jest.fn(() => {
        const clone = makeTrack()
        clone.label = track.label
        return clone
    })
    return track
}
const makeStream = track => ({ getTracks: () => [track], getAudioTracks: () => [track] })

let visibility = 'visible'
let tracks = []
let getUserMedia
let nativePlugin
let callOrder

const setVisibility = async state => {
    visibility = state
    await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
    })
}

const advance = async ms => {
    await act(async () => {
        await jest.advanceTimersByTimeAsync(ms)
    })
}

const installShell = () => {
    nativePlugin = {
        begin: jest.fn(async () => {
            callOrder.push('native:begin')
            return { backgroundAudio: true }
        }),
        end: jest.fn(async () => {
            callOrder.push('native:end')
            return {}
        }),
    }
    window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: { CallAudioSession: nativePlugin },
    }
}

// Every rendered tree is unmounted after its test: a still-mounted component keeps
// its `visibilitychange` listener and its peer connection, and would react to the
// NEXT test's visibility events with the next test's getUserMedia mock.
let trees = []

const render = (props = {}) => {
    let tree
    act(() => {
        tree = renderer.create(
            <AssistantVoiceCallProvider userId="user-1">
                <AssistantVoiceCallButton
                    assistant={{ uid: 'anna', displayName: 'Anna' }}
                    projectId="project-1"
                    {...props}
                />
            </AssistantVoiceCallProvider>
        )
    })
    trees.push(tree)
    return tree
}

const startCall = async tree => {
    const button = tree.root.findByType('Button')
    await act(async () => {
        await button.props.onPress()
    })
    await act(async () => {})
    return FakePeerConnection.instances[FakePeerConnection.instances.length - 1]
}

const findEndCallButton = tree => tree.root.findAllByType('Button').find(b => b.props.type === 'danger')

beforeEach(() => {
    jest.useFakeTimers()
    window.localStorage.clear()
    jest.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    FakePeerConnection.instances = []
    FakePeerConnection.liveStartupEvents = false
    callOrder = []
    tracks = []
    visibility = 'visible'
    window.history.replaceState({}, '', '/')
    document.title = ''

    window.RTCPeerConnection = FakePeerConnection
    getUserMedia = jest.fn(async () => {
        callOrder.push('getUserMedia')
        const track = makeTrack()
        tracks.push(track)
        return makeStream(track)
    })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    Object.defineProperty(navigator, 'mediaSession', {
        configurable: true,
        value: { metadata: null, playbackState: 'none', setActionHandler: jest.fn(), setMicrophoneActive: jest.fn() },
    })
    global.MediaMetadata = class {
        constructor(init) {
            Object.assign(this, init)
        }
    }

    createBotQuickTopic.mockResolvedValue({ chatId: 'chat-1', projectId: 'project-1', assistantId: 'anna' })
    runHttpsCallableFunction.mockResolvedValue({ answerSdp: 'answer-sdp' })
})

afterEach(() => {
    trees.forEach(tree => {
        act(() => {
            tree.unmount()
        })
    })
    trees = []
    delete window.Capacitor
    delete window.RTCPeerConnection
    delete global.MediaMetadata
    jest.useRealTimers()
    jest.restoreAllMocks()
})

describe('AssistantVoiceCallButton — background survival (AT-2496)', () => {
    it('keeps the same live connection and microphone when rotation crosses the popup breakpoint', async () => {
        const oldWidth = window.innerWidth
        const oldHeight = window.innerHeight
        window.innerWidth = 390
        window.innerHeight = 844
        FakePeerConnection.liveStartupEvents = true
        runHttpsCallableFunction.mockImplementation(async name =>
            name === 'startAssistantBrowserCallSecondGen'
                ? { answerSdp: 'answer', sessionId: 'browser-rotation', voiceProvider: 'gpt-live' }
                : { settled: true }
        )
        try {
            let tree
            act(() => {
                tree = renderer.create(
                    <AssistantVoiceCallProvider userId="user-1">
                        <AppPopover content={<span>Gold balance</span>} isOpen={false}>
                            <AssistantVoiceCallButton
                                assistant={{ uid: 'anna', displayName: 'Anna' }}
                                projectId="project-1"
                            />
                        </AppPopover>
                    </AssistantVoiceCallProvider>
                )
            })
            trees.push(tree)
            const pc = await startCall(tree)
            const track = tracks[0]
            for (const [width, height] of [
                [844, 390],
                [390, 844],
                [844, 390],
            ]) {
                await act(async () => {
                    window.innerWidth = width
                    window.innerHeight = height
                    window.dispatchEvent(new Event('resize'))
                })
                expect(pc.closed).toBe(false)
                expect(track.stop).not.toHaveBeenCalled()
                expect(findEndCallButton(tree)).toBeTruthy()
            }
            expect(FakePeerConnection.instances).toHaveLength(1)
            expect(getUserMedia).toHaveBeenCalledTimes(1)
            expect(runHttpsCallableFunction).not.toHaveBeenCalledWith(
                'endAssistantBrowserCallSecondGen',
                expect.anything()
            )
            act(() => tree.unmount())
            expect(pc.closed).toBe(true)
            expect(track.stop).toHaveBeenCalledTimes(1)
        } finally {
            window.innerWidth = oldWidth
            window.innerHeight = oldHeight
        }
    })

    it('connects through the fake peer connection and shows the end-call button', async () => {
        const tree = render()
        const pc = await startCall(tree)

        expect(getUserMedia).toHaveBeenCalledTimes(1)
        expect(pc.senders).toHaveLength(1)
        expect(runHttpsCallableFunction).toHaveBeenCalledWith(
            'startAssistantBrowserCallSecondGen',
            expect.objectContaining({ offerSdp: 'offer-sdp', chatId: 'chat-1' }),
            expect.any(Object)
        )
        expect(findEndCallButton(tree)).toBeTruthy()
        expect(navigator.mediaSession.playbackState).toBe('playing')
        expect(navigator.mediaSession.setMicrophoneActive).toHaveBeenCalledWith(true)
    })

    describe('iOS shell audio session', () => {
        it('configures the native session BEFORE opening the mic and releases it AFTER the capture stops', async () => {
            installShell()
            const tree = render()
            const pc = await startCall(tree)

            expect(callOrder.indexOf('native:begin')).toBeGreaterThanOrEqual(0)
            expect(callOrder.indexOf('native:begin')).toBeLessThan(callOrder.indexOf('getUserMedia'))

            const track = tracks[0]
            await act(async () => {
                findEndCallButton(tree).props.onPress()
            })
            await act(async () => {})

            expect(track.stop).toHaveBeenCalled()
            expect(pc.closed).toBe(true)
            expect(nativePlugin.end).toHaveBeenCalledTimes(1)
            expect(findEndCallButton(tree)).toBeUndefined()
        })

        it('starts the call anyway when the native plugin fails', async () => {
            installShell()
            nativePlugin.begin.mockRejectedValue(new Error('busy'))
            const tree = render()
            await startCall(tree)
            expect(getUserMedia).toHaveBeenCalledTimes(1)
            expect(findEndCallButton(tree)).toBeTruthy()

            await act(async () => {
                findEndCallButton(tree).props.onPress()
            })
            // No session was taken, so none is released.
            expect(nativePlugin.end).not.toHaveBeenCalled()
        })
    })

    describe('disconnect grace', () => {
        it('hangs up a visible call that stays disconnected past the short grace', async () => {
            const tree = render()
            const pc = await startCall(tree)

            await act(async () => pc.setConnectionState('disconnected'))
            await advance(VISIBLE_DISCONNECT_GRACE_MS - 1)
            expect(pc.closed).toBe(false)
            await advance(1)
            expect(pc.closed).toBe(true)
            expect(findEndCallButton(tree)).toBeUndefined()
        })

        it('does NOT hang up a hidden call on a transient disconnect, only after the long hidden grace', async () => {
            const tree = render()
            const pc = await startCall(tree)

            await setVisibility('hidden')
            await act(async () => pc.setConnectionState('disconnected'))

            await advance(VISIBLE_DISCONNECT_GRACE_MS * 3)
            expect(pc.closed).toBe(false)
            expect(findEndCallButton(tree)).toBeTruthy()

            await advance(HIDDEN_DISCONNECT_GRACE_MS)
            expect(pc.closed).toBe(true)
        })

        it('re-arms a running visible grace with the hidden value when the page hides', async () => {
            const tree = render()
            const pc = await startCall(tree)

            await act(async () => pc.setConnectionState('disconnected'))
            await advance(VISIBLE_DISCONNECT_GRACE_MS - 1000)
            await setVisibility('hidden')

            await advance(VISIBLE_DISCONNECT_GRACE_MS)
            expect(pc.closed).toBe(false)
        })

        it('collapses the grace back to the short value when the page returns still disconnected', async () => {
            const tree = render()
            const pc = await startCall(tree)

            await setVisibility('hidden')
            await act(async () => pc.setConnectionState('disconnected'))
            await advance(VISIBLE_DISCONNECT_GRACE_MS * 2)
            expect(pc.closed).toBe(false)

            await setVisibility('visible')
            await advance(VISIBLE_DISCONNECT_GRACE_MS - 1)
            expect(pc.closed).toBe(false)
            await advance(1)
            expect(pc.closed).toBe(true)
        })

        it('cancels the grace when the connection recovers, hidden or not', async () => {
            const tree = render()
            const pc = await startCall(tree)

            await setVisibility('hidden')
            await act(async () => pc.setConnectionState('disconnected'))
            await advance(HIDDEN_DISCONNECT_GRACE_MS / 2)
            await act(async () => pc.setConnectionState('connected'))
            await advance(HIDDEN_DISCONNECT_GRACE_MS)
            expect(pc.closed).toBe(false)
            expect(findEndCallButton(tree)).toBeTruthy()
        })
    })

    describe('microphone recovery', () => {
        const stallStats = [{ type: 'outbound-rtp', kind: 'audio', bytesSent: 4200 }]

        it('never reopens the microphone while hidden, even when the outbound audio stalls', async () => {
            const tree = render()
            const pc = await startCall(tree)
            pc.statsReports = stallStats

            await setVisibility('hidden')
            tracks[0].muted = true
            await advance(MIC_HEALTH_POLL_MS * 4)

            expect(getUserMedia).toHaveBeenCalledTimes(1)
            expect(tracks[0].stop).not.toHaveBeenCalled()
        })

        it('replays the deferred check after return and replaces a track that is still muted', async () => {
            const tree = render()
            const pc = await startCall(tree)
            pc.statsReports = stallStats

            await setVisibility('hidden')
            tracks[0].muted = true
            await advance(MIC_HEALTH_POLL_MS * 3)
            expect(getUserMedia).toHaveBeenCalledTimes(1)

            await setVisibility('visible')
            // Not immediately — the OS gets RETURN_MIC_SETTLE_MS to unmute the original track.
            expect(getUserMedia).toHaveBeenCalledTimes(1)
            await advance(RETURN_MIC_SETTLE_MS)
            expect(getUserMedia).toHaveBeenCalledTimes(2)
            expect(pc.senders[0].replaceTrack).toHaveBeenCalledWith(tracks[1].clone.mock.results[0].value)
            expect(tracks[0].stop).toHaveBeenCalled()
        })

        it('keeps the original track when the OS unmutes it within the settle window', async () => {
            const tree = render()
            const pc = await startCall(tree)
            pc.statsReports = stallStats

            await setVisibility('hidden')
            tracks[0].muted = true
            await advance(MIC_HEALTH_POLL_MS * 3)

            await setVisibility('visible')
            tracks[0].muted = false
            await advance(RETURN_MIC_SETTLE_MS)
            expect(getUserMedia).toHaveBeenCalledTimes(1)
            expect(tracks[0].stop).not.toHaveBeenCalled()
        })

        it('still recovers a stalled mic while visible (the pre-existing behaviour)', async () => {
            const tree = render()
            const pc = await startCall(tree)
            pc.statsReports = stallStats

            // Poll 1 seeds the byte counter; polls 2 and 3 are the two zero deltas
            // MIC_STALL_THRESHOLD asks for.
            await advance(MIC_HEALTH_POLL_MS * 3)
            expect(getUserMedia).toHaveBeenCalledTimes(2)
        })

        it('defers an ended track while hidden instead of calling getUserMedia from a hidden page', async () => {
            const tree = render()
            await startCall(tree)

            await setVisibility('hidden')
            tracks[0].readyState = 'ended'
            await act(async () => tracks[0].onended())
            expect(getUserMedia).toHaveBeenCalledTimes(1)

            await setVisibility('visible')
            await advance(RETURN_MIC_SETTLE_MS)
            expect(getUserMedia).toHaveBeenCalledTimes(2)
        })
    })

    it('ends the call from the media-session hangup action (lock screen / notification)', async () => {
        installShell()
        const tree = render()
        const pc = await startCall(tree)

        const hangup = navigator.mediaSession.setActionHandler.mock.calls.find(([action]) => action === 'hangup')[1]
        await act(async () => {
            hangup()
        })
        await act(async () => {})

        expect(pc.closed).toBe(true)
        expect(nativePlugin.end).toHaveBeenCalledTimes(1)
        expect(findEndCallButton(tree)).toBeUndefined()
    })

    it('tells an iOS browser user to keep the app open, and says nothing elsewhere', async () => {
        jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1'
        )
        const tree = render()
        await startCall(tree)
        const hint = 'Keep Alldone open during the call, this browser pauses the microphone in the background'
        expect(JSON.stringify(tree.toJSON())).toContain(hint)

        // The iOS shell carries the call natively — no hint.
        installShell()
        const shellTree = render()
        await startCall(shellTree)
        expect(JSON.stringify(shellTree.toJSON())).not.toContain(hint)
    })
})

describe('GPT-Live lifecycle', () => {
    test('keeps live events during mic health checks and collects final usage before closing', async () => {
        FakePeerConnection.liveStartupEvents = true
        runHttpsCallableFunction.mockImplementation(async name =>
            name === 'startAssistantBrowserCallSecondGen'
                ? { answerSdp: 'sdp', sessionId: 'browser-123', voiceProvider: 'gpt-live' }
                : { settled: true, finalVoiceUsage: true, voiceGold: 40, assistantGold: 2 }
        )
        const tree = render()
        const pc = await startCall(tree)
        expect(tracks[0].enabled).toBe(true)
        await advance(MIC_HEALTH_POLL_MS)
        expect(pc.channel.close).not.toHaveBeenCalled()
        let ending
        act(() => {
            ending = findEndCallButton(tree).props.onPress()
        })
        expect(tracks[0].enabled).toBe(false)
        expect(pc.closed).toBe(false)
        expect(pc.channel.send).toHaveBeenCalledWith(JSON.stringify({ type: 'session.close' }))
        await act(async () => {
            pc.channel.onmessage({ data: JSON.stringify({ type: 'session.closed', usage: { seconds: 60 } }) })
            await ending
        })
        expect(pc.closed).toBe(true)
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('getAssistantBrowserCallSummarySecondGen', {
            sessionId: 'browser-123',
        })
    })

    test('can use the existing topic instead of starting a separate conversation', async () => {
        createBotQuickTopic.mockClear()
        const tree = render({ chatId: 'existing-topic' })
        await startCall(tree)
        expect(createBotQuickTopic).not.toHaveBeenCalled()
        expect(runHttpsCallableFunction).toHaveBeenCalledWith(
            'startAssistantBrowserCallSecondGen',
            expect.objectContaining({ chatId: 'existing-topic', voiceProtocol: 'gpt-live-v2' }),
            expect.anything()
        )
    })
})

describe('voice connection recovery', () => {
    test('reports orientation history and the original peer failure before stopping media', async () => {
        runHttpsCallableFunction.mockClear()
        FakePeerConnection.liveStartupEvents = true
        runHttpsCallableFunction.mockImplementation(async name =>
            name === 'startAssistantBrowserCallSecondGen'
                ? { answerSdp: 'answer', sessionId: 'browser-diagnostics', voiceProvider: 'gpt-live' }
                : { closed: true, settled: true }
        )
        const tree = render()
        const pc = await startCall(tree)
        const oldWidth = window.innerWidth
        const oldHeight = window.innerHeight
        try {
            await act(async () => {
                window.innerWidth = 844
                window.innerHeight = 390
                window.dispatchEvent(new Event('orientationchange'))
                pc.setConnectionState('failed')
            })
            const report = runHttpsCallableFunction.mock.calls.find(
                ([name]) => name === 'endAssistantBrowserCallSecondGen'
            )[1]
            expect(report.diagnostics).toMatchObject({
                reason: 'peer_failed',
                peerState: 'failed',
                micReadyState: 'live',
                width: 844,
                height: 390,
            })
            expect(report.diagnostics.events).toContainEqual(
                expect.objectContaining({ event: 'orientation_change', orientation: 'landscape' })
            )
            expect(report.diagnostics.events.at(-1).event).toBe('cleanup')
            expect(pc.closed).toBe(true)
        } finally {
            window.innerWidth = oldWidth
            window.innerHeight = oldHeight
        }
    })
    test.each([
        { compact: true },
        { compact: false },
        { compact: true, variant: 'link' },
        { compact: false, variant: 'link' },
    ])('keeps one cancelable control while connecting (%j)', async props => {
        let respond
        runHttpsCallableFunction.mockImplementation(name =>
            name === 'startAssistantBrowserCallSecondGen'
                ? new Promise(resolve => {
                      respond = resolve
                  })
                : Promise.resolve({ closed: true })
        )
        const tree = render(props)
        const controls = () => [...tree.root.findAllByType('Button'), ...tree.root.findAllByType(TouchableOpacity)]
        let starting
        await act(async () => {
            starting = controls()[0].props.onPress()
            for (let i = 0; i < 30; i++) await Promise.resolve()
        })
        expect(respond).toBeDefined()
        expect(controls()).toHaveLength(1)
        expect(controls()[0].props.accessibilityLabel).toBe('Cancel assistant call')
        expect(controls()[0].props.disabled).not.toBe(true)
        // With the SDP answer still pending, the real data channel is not open yet.
        FakePeerConnection.instances[0].channel.readyState = 'connecting'
        await act(async () => {
            await controls()[0].props.onPress()
        })
        expect(tracks[0].stop).toHaveBeenCalled()
        expect(controls()).toHaveLength(1)
        expect(controls()[0].props.accessibilityLabel).toContain('Start voice call')
        await act(async () => {
            respond({ answerSdp: 'answer', sessionId: 'browser-cancelled', voiceProvider: 'gpt-live' })
            await starting
        })
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('endAssistantBrowserCallSecondGen', {
            sessionId: 'browser-cancelled',
        })
        expect(findEndCallButton(tree)).toBeUndefined()
    })

    test('closes the server session when an established data channel fails', async () => {
        FakePeerConnection.liveStartupEvents = true
        runHttpsCallableFunction.mockImplementation(async name =>
            name === 'startAssistantBrowserCallSecondGen'
                ? { answerSdp: 'answer', sessionId: 'browser-disconnected', voiceProvider: 'gpt-live' }
                : { closed: true, settled: true }
        )
        const tree = render()
        const pc = await startCall(tree)
        await act(async () => {
            pc.channel.onerror()
        })
        expect(pc.closed).toBe(true)
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('endAssistantBrowserCallSecondGen', {
            sessionId: 'browser-disconnected',
            diagnostics: expect.objectContaining({
                reason: 'data_channel_error',
                peerState: 'new',
                dataChannelState: 'open',
            }),
        })
    })
    test('can become ready when the server acknowledgement was missed', async () => {
        FakePeerConnection.liveStartupEvents = 'started-only'
        runHttpsCallableFunction.mockImplementation(async name =>
            name === 'startAssistantBrowserCallSecondGen'
                ? { answerSdp: 'answer', sessionId: 'browser-late-ack', voiceProvider: 'gpt-live' }
                : { controllerConnected: true, settled: false }
        )
        const tree = render()
        await startCall(tree)
        expect(findEndCallButton(tree)).toBeDefined()
        expect(tracks[0].enabled).toBe(true)
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('getAssistantBrowserCallSummarySecondGen', {
            sessionId: 'browser-late-ack',
        })
    })
    test('offers a user gesture to recover blocked Chrome audio playback', async () => {
        const play = jest
            .spyOn(window.HTMLMediaElement.prototype, 'play')
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(Object.assign(new Error('Blocked'), { name: 'NotAllowedError' }))
            .mockResolvedValue(undefined)
        try {
            const tree = render({ compact: true })
            const pc = await startCall(tree)
            await act(async () => {
                pc.ontrack({ streams: [makeStream(makeTrack())] })
            })
            const enable = tree.root
                .findAllByType('Button')
                .find(button => button.props.accessibilityLabel === 'Enable call audio')
            expect(enable).toBeDefined()
            await act(async () => {
                await enable.props.onPress()
            })
            expect(
                tree.root
                    .findAllByType('Button')
                    .some(button => button.props.accessibilityLabel === 'Enable call audio')
            ).toBe(false)
        } finally {
            play.mockRestore()
        }
    })
    test('double clicks cannot create two paid calls', async () => {
        runHttpsCallableFunction.mockClear()
        const tree = render()
        const onPress = tree.root.findByType('Button').props.onPress
        await act(async () => {
            await Promise.all([onPress(), onPress()])
        })
        expect(
            runHttpsCallableFunction.mock.calls.filter(([name]) => name === 'startAssistantBrowserCallSecondGen')
        ).toHaveLength(1)
    })
    test('closes a provider session if its answer arrives after the caller left', async () => {
        let respond
        runHttpsCallableFunction.mockImplementation(name =>
            name === 'startAssistantBrowserCallSecondGen'
                ? new Promise(resolve => {
                      respond = resolve
                  })
                : Promise.resolve({ closed: true })
        )
        const tree = render()
        let starting
        await act(async () => {
            starting = tree.root.findByType('Button').props.onPress()
            for (let i = 0; i < 30; i++) await Promise.resolve()
        })
        expect(respond).toBeDefined()
        act(() => {
            tree.unmount()
        })
        await act(async () => {
            respond({ answerSdp: 'answer', sessionId: 'browser-left', voiceProvider: 'gpt-live' })
            await starting
        })
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('endAssistantBrowserCallSecondGen', {
            sessionId: 'browser-left',
        })
        expect(tracks[0].stop).toHaveBeenCalled()
    })
})

test('waits for successful remote playback before requesting Annas greeting', async () => {
    FakePeerConnection.liveStartupEvents = true
    runHttpsCallableFunction.mockImplementation(async name =>
        name === 'startAssistantBrowserCallSecondGen'
            ? { answerSdp: 'answer', sessionId: 'browser-greeting', voiceProvider: 'gpt-live' }
            : { settled: false, controllerConnected: true }
    )
    let playing
    jest.spyOn(window.HTMLMediaElement.prototype, 'play')
        .mockResolvedValueOnce(undefined) // user-gesture priming
        .mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    playing = resolve
                })
        )
        .mockResolvedValue(undefined)
    const tree = render()
    const pc = await startCall(tree)
    const greetings = () =>
        pc.channel.send.mock.calls.map(([json]) => JSON.parse(json)).filter(e => e.event_id === 'alldone_live_greeting')
    expect(greetings()).toHaveLength(0)
    await act(async () => {
        pc.ontrack({ streams: [makeStream(makeTrack())] })
    })
    expect(greetings()).toHaveLength(0)
    await act(async () => {
        playing()
        await Promise.resolve()
    })
    expect(greetings()).toHaveLength(1)
    expect(greetings()[0].content).toBe('Hello, how can I help?')
    await setVisibility('hidden')
    await setVisibility('visible')
    expect(greetings()).toHaveLength(1)
})

test('an unused previous microphone cannot trigger another recovery', async () => {
    const tree = render()
    await startCall(tree)
    const old = tracks[0]
    await act(async () => {
        old.onended()
        for (let i = 0; i < 20; i++) await Promise.resolve()
    })
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    await act(async () => {
        old.onended()
        for (let i = 0; i < 20; i++) await Promise.resolve()
    })
    expect(getUserMedia).toHaveBeenCalledTimes(2)
})

test.each(['hangup', 'unmount', 'capture-failure'])(
    'sets the mobile audio category before playback/capture and releases it on %s',
    async ending => {
        const previousUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' })
        const audioSession = { type: 'auto' }
        Object.defineProperty(navigator, 'audioSession', { configurable: true, value: audioSession })
        const play = window.HTMLMediaElement.prototype.play
        play.mockImplementation(async () => {
            expect(audioSession.type).toBe('play-and-record')
        })
        const capture = getUserMedia.getMockImplementation()
        getUserMedia.mockImplementation(async constraints => {
            expect(audioSession.type).toBe('play-and-record')
            if (ending === 'capture-failure') throw new Error('Permission denied')
            return capture(constraints)
        })
        const tree = render()
        try {
            await startCall(tree)
            if (ending !== 'capture-failure') {
                expect(audioSession.type).toBe('play-and-record')
                await act(async () => {
                    if (ending === 'unmount') tree.unmount()
                    else await findEndCallButton(tree).props.onPress()
                })
                expect(tracks[0].stop).toHaveBeenCalled()
            }
            expect(audioSession.type).toBe('auto')
        } finally {
            act(() => tree.unmount())
            delete navigator.audioSession
            if (previousUserAgent) Object.defineProperty(navigator, 'userAgent', previousUserAgent)
            else delete navigator.userAgent
        }
    }
)

const routeTree = (page, userId = 'user-1') => (
    <AssistantVoiceCallProvider userId={userId}>
        <div key={page}>
            {page === 'tasks' && (
                <AssistantVoiceCallButton assistant={{ uid: 'anna', displayName: 'Anna' }} projectId="project-1" />
            )}
            {page === 'notes' && (
                <AssistantVoiceCallButton
                    assistant={{ uid: 'other', displayName: 'Other assistant' }}
                    projectId="project-2"
                />
            )}
            <button onClick={jest.fn()}>{page}</button>
        </div>
    </AssistantVoiceCallProvider>
)

test('navigation removes the original launcher but keeps one call, audio and a usable floating hangup', async () => {
    FakePeerConnection.liveStartupEvents = true
    runHttpsCallableFunction.mockImplementation(async name =>
        name === 'startAssistantBrowserCallSecondGen'
            ? { answerSdp: 'answer', sessionId: 'browser-navigation', voiceProvider: 'gpt-live' }
            : { updated: true }
    )
    let tree
    act(() => {
        tree = renderer.create(routeTree('tasks'))
    })
    trees.push(tree)
    const pc = await startCall(tree)
    const track = tracks[0]
    const audio = document.querySelector('audio')
    for (const page of ['notes', 'settings', 'tasks']) {
        await act(async () => {
            tree.update(routeTree(page))
            window.history.pushState({}, '', `/projects/${page}`)
            document.title = page
            await jest.advanceTimersByTimeAsync(500)
        })
        expect(runHttpsCallableFunction).toHaveBeenCalledWith(
            'updateAssistantBrowserCallContextSecondGen',
            expect.objectContaining({
                sessionId: 'browser-navigation',
                pageContext: { path: `/projects/${page}`, title: page },
            })
        )
        expect(pc.closed).toBe(false)
        expect(track.stop).not.toHaveBeenCalled()
        expect(document.querySelector('audio')).toBe(audio)
        expect(tree.root.findAllByType('Button')).toHaveLength(1)
        expect(findEndCallButton(tree).props.accessibilityLabel).toBe('End assistant call')
        const appButton = tree.root.findByType('button')
        act(() => appButton.props.onClick())
        expect(appButton.props.onClick).toHaveBeenCalledTimes(1)
    }
    expect(FakePeerConnection.instances).toHaveLength(1)
    let ending
    await act(async () => {
        ending = findEndCallButton(tree).props.onPress()
        pc.channel.onmessage({ data: JSON.stringify({ type: 'session.closed', usage: { seconds: 30 } }) })
        await ending
    })
    expect(pc.closed).toBe(true)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(tree.root.findAllByProps({ testID: 'floating-voice-call' })).toHaveLength(0)
})

test('navigation during startup keeps the pending call, but signing out releases it', async () => {
    let respond
    FakePeerConnection.liveStartupEvents = true
    runHttpsCallableFunction.mockImplementation(name =>
        name === 'startAssistantBrowserCallSecondGen'
            ? new Promise(resolve => {
                  respond = resolve
              })
            : Promise.resolve({ updated: true })
    )
    let tree
    act(() => {
        tree = renderer.create(routeTree('tasks'))
    })
    trees.push(tree)
    let starting
    await act(async () => {
        starting = tree.root.findByType('Button').props.onPress()
        for (let i = 0; i < 30; i++) await Promise.resolve()
    })
    await act(async () => {
        tree.update(routeTree('settings'))
    })
    expect(tree.root.findByType('Button').props.accessibilityLabel).toBe('Cancel assistant call')
    await act(async () => {
        respond({ answerSdp: 'answer', sessionId: 'browser-navigation', voiceProvider: 'gpt-live' })
        await starting
    })
    expect(FakePeerConnection.instances[0].closed).toBe(false)
    await act(async () => {
        tree.update(routeTree('settings', null))
    })
    expect(FakePeerConnection.instances[0].closed).toBe(true)
    expect(tracks[0].stop).toHaveBeenCalled()
    expect(runHttpsCallableFunction).toHaveBeenCalledWith(
        'endAssistantBrowserCallSecondGen',
        expect.objectContaining({
            sessionId: 'browser-navigation',
            diagnostics: expect.objectContaining({ reason: 'account_changed' }),
        })
    )
})

test('selects and meters a working microphone during connection setup while the sender remains muted', async () => {
    const micCapture = require('../../hooks/rambleMicCapture')
    const builtin = makeTrack(),
        usb = makeTrack()
    builtin.label = 'Built-in microphone'
    usb.label = 'USB microphone'
    builtin.getSettings = () => ({ deviceId: 'builtin', groupId: 'builtin' })
    usb.getSettings = () => ({ deviceId: 'usb', groupId: 'usb' })
    const inputs = { builtin: makeStream(builtin), usb: makeStream(usb) }
    jest.spyOn(micCapture, 'createInputLevelMonitor').mockImplementation(stream => ({
        ready: Promise.resolve(),
        sample: jest.fn(),
        isRunning: () => true,
        getLevel: () => (stream === inputs.usb && usb.enabled ? 0.25 : 0),
        getPeak: () => (stream === inputs.usb && usb.enabled ? 0.25 : 0),
        close: jest.fn(),
    }))
    navigator.mediaDevices.enumerateDevices = jest.fn(async () => [
        { kind: 'audioinput', deviceId: 'builtin', groupId: 'builtin' },
        { kind: 'audioinput', deviceId: 'usb', groupId: 'usb' },
    ])
    getUserMedia.mockImplementation(async ({ audio }) => inputs[audio.deviceId?.exact || 'builtin'])
    let respond
    FakePeerConnection.liveStartupEvents = true
    runHttpsCallableFunction.mockImplementation(name =>
        name === 'startAssistantBrowserCallSecondGen'
            ? new Promise(resolve => {
                  respond = resolve
              })
            : Promise.resolve({ updated: true })
    )
    const tree = render()
    let starting
    await act(async () => {
        starting = tree.root.findByType('Button').props.onPress()
        for (let i = 0; i < 30; i++) await Promise.resolve()
    })
    const pc = FakePeerConnection.instances[0]
    expect(builtin.enabled).toBe(true)
    expect(pc.senders[0].track.enabled).toBe(false)
    await advance(1600)
    expect(pc.senders[0].track.label).toBe('USB microphone')
    expect(pc.senders[0].track.enabled).toBe(false)
    expect(tree.root.findByProps({ testID: 'voice-microphone-name' }).props.children).toBe('USB microphone')
    expect(tree.root.findByProps({ testID: 'voice-microphone-level' }).props.accessibilityValue.now).toBe(50)
    expect(pc.channel.send).not.toHaveBeenCalled()
    await act(async () => {
        respond({ answerSdp: 'answer', sessionId: 'browser-warmed-mic', voiceProvider: 'gpt-live' })
        await starting
    })
    expect(pc.senders[0].track.label).toBe('USB microphone')
    expect(pc.senders[0].track.enabled).toBe(true)
    act(() => tree.unmount())
    expect(builtin.readyState).toBe('ended')
    expect(usb.readyState).toBe('ended')
    expect(pc.senders[0].track.readyState).toBe('ended')
    const ended = runHttpsCallableFunction.mock.calls.find(
        ([name, data]) =>
            name === 'endAssistantBrowserCallSecondGen' && data.sessionId === 'browser-warmed-mic' && data.diagnostics
    )
    expect(ended[1].diagnostics.events.map(e => e.event)).toEqual(
        expect.arrayContaining([
            'microphone_acquired',
            'microphone_changed',
            'microphone_first_signal',
            'microphone_sent',
        ])
    )
})

test('cancelling during microphone warmup cannot unmute or greet when warmup finishes', async () => {
    let prepared
    const warmup = new Promise(resolve => {
        prepared = resolve
    })
    jest.spyOn(require('./assistantVoiceMicrophone'), 'createVoiceMicrophoneSelector').mockReturnValue({
        whenPrepared: () => warmup,
        getSnapshot: () => ({ available: true, level: 0.1 }),
        stop: jest.fn(() => prepared(false)),
    })
    FakePeerConnection.liveStartupEvents = true
    runHttpsCallableFunction.mockImplementation(async name =>
        name === 'startAssistantBrowserCallSecondGen'
            ? { answerSdp: 'answer', sessionId: 'browser-cancel-warmup', voiceProvider: 'gpt-live' }
            : { settled: true }
    )
    const tree = render()
    let starting, ending
    await act(async () => {
        starting = tree.root.findByType('Button').props.onPress()
        for (let i = 0; i < 30; i++) await Promise.resolve()
    })
    const pc = FakePeerConnection.instances[0]
    await act(async () => {
        ending = findEndCallButton(tree).props.onPress()
        prepared(true)
        await starting
    })
    expect(pc.senders[0].track.enabled).toBe(false)
    expect(findEndCallButton(tree).props.disabled).toBe(true)
    expect(pc.channel.send.mock.calls.map(([json]) => JSON.parse(json).event_id)).not.toContain('alldone_live_greeting')
    await act(async () => {
        pc.channel.onmessage({ data: JSON.stringify({ type: 'session.closed' }) })
        await ending
    })
})
