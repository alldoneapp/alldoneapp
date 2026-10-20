import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaConversation from '../../components/Anna/AnnaConversation'
import useAssistantVoiceCall from '../../components/UIComponents/useAssistantVoiceCall'
import { setLanguage } from '../../i18n/TranslationService'
setLanguage('en')
window.timeline = []
window.remoteContext = null
class Peer {
    constructor() {
        window.peer = this
        this.connectionState = 'new'
        this.iceGatheringState = 'complete'
        this.senders = []
    }
    addTrack(track) {
        const sender = {
            track,
            replaceTrack: async t => {
                sender.track = t
            },
        }
        this.senders.push(sender)
    }
    getSenders() {
        return this.senders
    }
    createDataChannel() {
        this.channel = {
            readyState: 'open',
            close() {},
            send: data => {
                const event = JSON.parse(data)
                window.timeline.push({ event: event.type, ringLoop: document.querySelector('audio')?.loop })
                if (event.type === 'session.close')
                    this.channel.onmessage({ data: JSON.stringify({ type: 'session.closed' }) })
            },
        }
        return this.channel
    }
    async createOffer() {
        return { type: 'offer', sdp: 'fixture' }
    }
    async setLocalDescription(d) {
        this.localDescription = d
    }
    async setRemoteDescription() {
        // Deliver the remote track BEFORE provider readiness. Ringback must continue.
        const ctx = new AudioContext()
        window.remoteContext = ctx
        await ctx.resume()
        const dest = ctx.createMediaStreamDestination()
        const osc = ctx.createOscillator(),
            gain = ctx.createGain()
        gain.gain.value = 0 // remote silence: isolates the ringback-to-greeting boundary
        osc.connect(gain).connect(dest)
        osc.start()
        this.ontrack({ streams: [dest.stream] })
        this.channel.onmessage({ data: JSON.stringify({ type: 'session.started' }) })
        window.ready = () =>
            this.channel.onmessage({
                data: JSON.stringify({ type: 'session.instructions.appended', client_event_id: 'alldone_live_ready' }),
            })
    }
    async getStats() {
        return []
    }
    close() {
        this.connectionState = 'closed'
    }
    addEventListener() {}
    removeEventListener() {}
}
window.RTCPeerConnection = Peer
function Harness() {
    const call = useAssistantVoiceCall()
    window.call = call
    useEffect(() => {
        if (new URLSearchParams(location.search).get('scenario') === 'autoplay') {
            void call.startCall({ assistant: { displayName: 'Anna' }, resolveTarget: () => new Promise(() => {}) })
        }
    }, [])
    return (
        <AnnaConversation
            user={{ uid: 'u1', gold: 100 }}
            conversation={{ id: 'cached', projectId: 'p1', assistantId: 'a1' }}
            assistant={{ uid: 'a1', displayName: 'Anna' }}
            call={call}
            resolveConversation={() =>
                new Promise((resolve, reject) => {
                    window.resolveThread = () => resolve({ id: 'today', projectId: 'p1', assistantId: 'a1' })
                    window.rejectThread = () => reject(new Error('Thread lookup failed'))
                })
            }
            onBeforeSend={() =>
                new Promise(resolve => {
                    window.handback = resolve
                })
            }
        />
    )
}
createRoot(document.getElementById('root')).render(<Harness />)
