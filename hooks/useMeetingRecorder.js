import { useEffect, useRef, useState } from 'react'
import v4 from 'uuid/v4'
import { createMeetingCapture } from '../utils/meetingCapture'
import { meetingBlobBase64 } from '../utils/meetingAudio'
import { drainMeetingQueue, openMeetingQueue } from '../utils/meetingQueue'
import { runHttpsCallableFunction } from '../utils/backends/firestore'

// Scoped to the authenticated user AND note. Opening that note resumes stored chunks,
// never microphone access. Web Locks serialize recovery across tabs on this origin.
export default function useMeetingRecorder({ userId, noteId, projectId, enabled, persist, getInsertionTarget }) {
    const [state, setState] = useState({
        phase: 'idle',
        pending: 0,
        error: '',
        captureError: '',
        elapsed: 0,
        device: '',
        signal: false,
    })
    const controller = useRef(null)
    const persistRef = useRef(persist)
    persistRef.current = persist
    const getInsertionTargetRef = useRef(getInsertionTarget)
    getInsertionTargetRef.current = getInsertionTarget

    useEffect(() => {
        if (!enabled || !userId || !noteId) {
            setState({ phase: 'idle', pending: 0, error: '', captureError: '', elapsed: 0, device: '', signal: false })
            return
        }
        const owner = `${userId}:${noteId}`
        let active = true
        let queue, capture, releaseRecordingLock, timer, retryTimer
        let busy = false
        let phase = 'idle'
        let attempt = 0
        let generation = 0
        let writeChain = Promise.resolve()
        const unsaved = new Map()
        const update = patch => active && setState(previous => ({ ...previous, ...patch }))
        const stop = async () => {
            generation++
            phase = 'stopping'
            update({ phase })
            await capture?.stop()
            await writeChain
            releaseRecordingLock?.()
            releaseRecordingLock = null
            clearInterval(timer)
            phase = 'idle'
            update({ phase })
        }
        const pump = async () => {
            if (!active || !queue || busy) return
            busy = true
            clearTimeout(retryTimer)
            try {
                await writeChain
                for (const chunk of unsaved.values()) {
                    await queue.enqueue(chunk)
                    unsaved.delete(chunk.id)
                }
                await navigator.locks.request(`meeting-queue:${owner}`, { ifAvailable: true }, async lock => {
                    if (!lock || !active) return
                    await drainMeetingQueue({
                        queue,
                        owner,
                        isActive: () => active,
                        transcribe: async chunk => {
                            const result = await runHttpsCallableFunction('transcribeMeetingAudio', {
                                audioChunk: await meetingBlobBase64(chunk.blob),
                                sessionId: chunk.sessionId,
                                chunkIndex: chunk.sequence,
                                projectId,
                                noteId,
                            })
                            return result.text
                        },
                        persist: chunk => (active ? persistRef.current(chunk) : false),
                        onPending: pending => update({ pending }),
                    })
                })
                attempt = 0
                update({ error: '' })
            } catch (error) {
                const code = unsaved.size
                    ? 'storage'
                    : String(error.code || error.message || 'retry').replace('functions/', '')
                update({ error: code })
                if (unsaved.size || ['resource-exhausted', 'permission-denied', 'unauthenticated'].includes(code))
                    stop()
                attempt++
            } finally {
                busy = false
                if (active) retryTimer = setTimeout(pump, Math.min(60000, 2000 * 2 ** Math.min(attempt, 5)))
            }
        }
        const open = () =>
            openMeetingQueue()
                .then(value => {
                    queue = value
                    if (active) {
                        phase = phase === 'unavailable' ? 'idle' : phase
                        update({ phase, captureError: '' })
                        pump()
                    } else queue.close()
                })
                .catch(() => {
                    phase = 'unavailable'
                    update({ captureError: 'storage', phase })
                })
        const ready = open()

        const start = async () => {
            if (phase !== 'idle') return
            const token = ++generation
            phase = 'starting'
            update({ phase, captureError: '', elapsed: 0 })
            try {
                // Capture before awaiting storage, locks or a microphone permission prompt.
                const insertionTarget = getInsertionTargetRef.current?.()
                await ready
                if (!active || phase !== 'starting' || generation !== token) return
                if (!queue || unsaved.size) throw new Error('storage')
                const estimate = await navigator.storage?.estimate?.()
                // 16kHz PCM needs ~116 MB/hour; leave room for notes and browser overhead.
                if (estimate?.quota && estimate.quota - estimate.usage < 150 * 1024 * 1024) throw new Error('storage')
                navigator.storage?.persist?.().catch(() => {})
                await navigator.locks.request(`meeting-recording:${owner}`, { ifAvailable: true }, async lock => {
                    if (!active || phase !== 'starting' || generation !== token) return
                    if (!lock) throw new Error('another-tab')
                    const sessionId = v4()
                    const createdAt = Date.now()
                    let sequence = 0
                    capture = createMeetingCapture({
                        onChunk: blob => {
                            const chunk = {
                                id: `${sessionId}:${sequence}`,
                                owner,
                                sessionId,
                                sequence: sequence++,
                                createdAt,
                                blob,
                                ...(insertionTarget ? { insertionTarget } : {}),
                            }
                            unsaved.set(chunk.id, chunk)
                            writeChain = writeChain.then(async () => {
                                try {
                                    await queue.enqueue(chunk)
                                    unsaved.delete(chunk.id)
                                    if (active) update({ pending: (await queue.list(owner)).length })
                                } catch (_) {
                                    update({ error: 'storage' })
                                    stop()
                                }
                            })
                            writeChain.then(pump)
                            if (unsaved.size > 3) {
                                update({ error: 'storage' })
                                stop()
                            }
                        },
                        onError: captureError => update({ captureError }),
                        onLevel: signal => update({ signal }),
                        onStopped: () => {
                            clearInterval(timer)
                            phase = 'stopping'
                            update({ phase })
                            writeChain.then(() => {
                                phase = 'idle'
                                update({ phase })
                                releaseRecordingLock?.()
                                releaseRecordingLock = null
                            })
                        },
                    })
                    // Own the lock throughout acquisition, capture and final flush.
                    const finished = new Promise(resolve => {
                        releaseRecordingLock = resolve
                    })
                    const device = await capture.start()
                    if (device !== false && active && phase === 'starting' && generation === token) {
                        phase = 'recording'
                        const started = Date.now()
                        update({ phase, device })
                        timer = setInterval(() => update({ elapsed: Math.floor((Date.now() - started) / 1000) }), 1000)
                    }
                    await finished
                })
            } catch (error) {
                if (generation === token) {
                    phase = 'idle'
                    update({ phase, captureError: error.message || 'capture-interrupted' })
                }
            }
        }
        const unload = event => {
            if (phase !== 'idle' || unsaved.size) {
                event.preventDefault()
                event.returnValue = ''
            }
        }
        const pagehide = () => {
            stop()
        }
        window.addEventListener('beforeunload', unload)
        window.addEventListener('pagehide', pagehide)
        window.addEventListener('online', pump)
        controller.current = { start, stop, retry: () => (queue ? pump() : open()) }
        setState({ phase: 'idle', pending: 0, error: '', captureError: '', elapsed: 0, device: '', signal: false })
        return () => {
            active = false
            clearTimeout(retryTimer)
            window.removeEventListener('beforeunload', unload)
            window.removeEventListener('pagehide', pagehide)
            window.removeEventListener('online', pump)
            stop()
                .then(() => writeChain)
                .then(() => queue?.close())
            controller.current = null
        }
    }, [userId, noteId, projectId, enabled])

    return {
        ...state,
        start: () => controller.current?.start(),
        stop: () => controller.current?.stop(),
        retry: () => controller.current?.retry(),
    }
}
