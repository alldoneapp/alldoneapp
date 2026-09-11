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

const { runHttpsCallableFunction } = require('../../utils/backends/firestore')
const { createBotQuickTopic } = require('../../utils/assistantHelper')
const AssistantVoiceCallButton = require('./AssistantVoiceCallButton').default

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
        return {}
    }
    async createOffer() {
        return { type: 'offer', sdp: 'offer-sdp' }
    }
    async setLocalDescription(description) {
        this.localDescription = description
    }
    async setRemoteDescription() {}
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
    const track = { kind: 'audio', readyState: 'live', muted: false, stop: jest.fn() }
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
            <AssistantVoiceCallButton
                assistant={{ uid: 'anna', displayName: 'Anna' }}
                projectId="project-1"
                {...props}
            />
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
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    FakePeerConnection.instances = []
    callOrder = []
    tracks = []
    visibility = 'visible'

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
            expect(pc.senders[0].replaceTrack).toHaveBeenCalledWith(tracks[1])
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
        Object.defineProperty(navigator, 'userAgent', {
            configurable: true,
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1',
        })
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
