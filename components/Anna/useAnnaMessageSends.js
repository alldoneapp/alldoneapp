import { useCallback, useEffect, useRef, useState } from 'react'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { commentOutbox } from '../../utils/backends/Chats/commentOutbox'
import { STAYWARD_COMMENT } from '../Feeds/Utils/HelperFunctions'
import { getDb, runHttpsCallableFunction } from '../../utils/backends/firestore'
import { translate } from '../../i18n/TranslationService'

// Keep each submission separate from the next draft and from other assistant
// runs. Its permanent outbox ID is also the backend's idempotency key on retry.
export default function useAnnaMessageSends({
    userId,
    conversation,
    resolveConversation,
    onBeforeSend,
    onSendingChange,
}) {
    const [messages, setMessages] = useState([])
    const jobs = useRef(new Map())
    const sequence = useRef(0)
    const owner = useRef(userId)
    const mounted = useRef(true)
    const preparation = useRef(Promise.resolve())
    owner.current = userId
    const publish = useCallback(() => {
        if (mounted.current) setMessages([...jobs.current.values()].map(job => ({ ...job })))
    }, [])
    const sending = messages.some(message => message.userId === userId && message.running)
    useEffect(() => {
        onSendingChange?.(sending)
    }, [sending, onSendingChange])
    useEffect(() => () => onSendingChange?.(false), [onSendingChange])
    useEffect(() => {
        jobs.current.forEach((job, key) => {
            if (job.userId !== userId) jobs.current.delete(key)
        })
        publish()
    }, [userId, publish])
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])

    const run = job => {
        if (job.running || job.userId !== owner.current) return
        job.running = true
        job.error = ''
        job.status = 'sending'
        publish()
        const isActive = () => mounted.current && owner.current === job.userId
        // Preserve submission order through persistence and request dispatch,
        // without making the next message wait for the assistant's answer.
        const prepared = preparation.current
            .catch(() => {})
            .then(async () => {
                if (!isActive()) return null
                if (!job.resolved) {
                    const thread = resolveConversation ? await resolveConversation() : conversation
                    if (!thread?.id)
                        throw new Error(translate('Your conversation could not be loaded. Please try again.'))
                    job.thread = thread
                    job.resolved = true
                }
                if (!isActive()) return null
                const thread = job.thread
                if (!thread?.id) throw new Error(translate('Your conversation could not be loaded. Please try again.'))
                publish()
                if (!job.continuation) await onBeforeSend?.()
                if (!isActive()) return null
                // Capture context at submission time, before the user opens another page.
                await getDb()
                    .doc(`chatObjects/${thread.projectId}/chats/${thread.id}`)
                    .update({ annaPageContext: job.context })
                if (!isActive()) return null
                if (!job.id) {
                    job.id = await createObjectMessage(
                        thread.projectId,
                        thread.id,
                        job.text,
                        'topics',
                        STAYWARD_COMMENT,
                        null,
                        null,
                        true,
                        true,
                        thread.assistantId
                    )
                    if (!job.id) throw new Error(translate('Your message could not be sent. Please try again.'))
                    publish()
                }
                // createObjectMessage acknowledges local storage, not Firestore.
                // Never ask the assistant to read a comment that is still in the outbox.
                await commentOutbox.retry(job.userId, job.id)
                const pending = commentOutbox.read(job.userId, job.id)
                if (pending && pending.status !== 'sent')
                    throw new Error(translate('Your message could not be sent. Please try again.'))
                if (!isActive()) return null
                job.status = 'working'
                publish()
                return {
                    response: runHttpsCallableFunction(
                        'askToBotSecondGen',
                        {
                            userId: job.userId,
                            projectId: thread.projectId,
                            objectId: thread.id,
                            objectType: 'topics',
                            messageId: job.id,
                            assistantId: thread.assistantId,
                            userIdsToNotify: [job.userId],
                            isPublicFor: thread.isPublicFor || [0],
                            followerIds: [job.userId],
                            language: window.navigator.language,
                        },
                        { timeout: 3600000 }
                    ),
                }
            })
        preparation.current = prepared
        prepared
            .then(result => result?.response)
            .then(() => {
                job.status = 'sent'
            })
            .catch(failure => {
                job.status = 'failed'
                job.error = failure.message || translate('Your message could not be sent. Please try again.')
            })
            .finally(() => {
                job.running = false
                if (job.status === 'sent' && job.acknowledged) jobs.current.delete(job.key)
                publish()
            })
    }
    const submit = (text, context, continuation) => {
        const job = {
            key: `local-${++sequence.current}`,
            userId,
            text,
            context,
            created: Date.now(),
            thread: continuation?.thread || conversation,
            resolved: !!continuation?.thread,
            continuation: !!continuation,
        }
        jobs.current.set(job.key, job)
        run(job)
    }
    const retry = key => {
        const job = jobs.current.get(key)
        if (job?.status === 'failed') run(job)
    }
    const acknowledge = useCallback(
        (projectId, chatId, ids) => {
            let changed = false
            jobs.current.forEach((job, key) => {
                if (job.thread?.projectId !== projectId || job.thread?.id !== chatId || !ids.includes(job.id)) return
                job.acknowledged = true
                if (job.status === 'sent') {
                    jobs.current.delete(key)
                    changed = true
                }
            })
            if (changed) publish()
        },
        [publish]
    )
    return { messages: messages.filter(message => message.userId === userId), sending, submit, retry, acknowledge }
}
