import { useCallback, useEffect, useRef, useState } from 'react'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
import { commentOutbox } from '../../utils/backends/Chats/commentOutbox'
import { STAYWARD_COMMENT, updateNewAttachmentsData } from '../Feeds/Utils/HelperFunctions'
import { NEW_ATTACHMENT } from '../Feeds/CommentsTextInput/textInputHelper'
import {
    REGEX_ATTACHMENT,
    REGEX_IMAGE,
    REGEX_VIDEO,
    getAttachmentData,
    getImageData,
    getVideoData,
} from '../../functions/Utils/parseTextUtils'
import { getDb, getId, runHttpsCallableFunction } from '../../utils/backends/firestore'
import { translate } from '../../i18n/TranslationService'
import { flushAnnaActivityContext } from './annaActivityContext'
import {
    REPLY_FAILED,
    getConfirmationDeadline,
    isConnectionLoss,
    replyConfirmsProcessing,
} from './annaSubmissionReconciliation'

const isPageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
const threadKey = (projectId, chatId) => `${projectId}/${chatId}`

const hasNewAttachments = text =>
    text.split(' ').some(word => {
        if (REGEX_ATTACHMENT.test(word)) return getAttachmentData(word).isNew === NEW_ATTACHMENT
        if (REGEX_IMAGE.test(word)) return getImageData(word).isNew === NEW_ATTACHMENT
        if (REGEX_VIDEO.test(word)) return getVideoData(word).isNew === NEW_ATTACHMENT
        return false
    })

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
    // Latest persisted replies per thread, keyed by the message that triggered them (AT-2921).
    const replies = useRef(new Map())
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
            if (job.userId === userId) return
            job.stopConfirming?.()
            jobs.current.delete(key)
        })
        publish()
    }, [userId, publish])
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            jobs.current.forEach(job => job.stopConfirming?.())
        }
    }, [])

    const replyFor = job =>
        job.id && job.thread?.id ? replies.current.get(threadKey(job.thread.projectId, job.thread.id))?.[job.id] : null

    // The server took the request: drop any transport error and let the persisted reply speak.
    const settleProcessed = job => {
        job.stopConfirming?.()
        job.status = 'sent'
        job.error = ''
        if (job.acknowledged) jobs.current.delete(job.key)
    }
    const settleFailed = (job, error) => {
        job.stopConfirming?.()
        job.status = 'failed'
        job.error = error
    }

    // A connection lost after dispatch says nothing about the run. Wait for the reply the server
    // writes either way (its own run, or the missed-run catch-up), and only report a failure if
    // none arrives while the page is visible. While waiting there is no Retry, so a resumed app
    // cannot start a second submission of a message that is already being answered.
    const confirm = job => {
        job.status = 'confirming'
        job.error = ''
        let timer = null
        let onVisible = null
        const stop = () => {
            clearTimeout(timer)
            if (onVisible) document.removeEventListener('visibilitychange', onVisible)
            timer = null
            onVisible = null
            if (job.stopConfirming === stop) job.stopConfirming = null
        }
        const arm = () => {
            stop()
            job.stopConfirming = stop
            if (isPageHidden()) {
                onVisible = () => {
                    if (!isPageHidden()) arm()
                }
                document.addEventListener('visibilitychange', onVisible)
                return
            }
            const now = Date.now()
            timer = setTimeout(
                () => {
                    if (job.status !== 'confirming' || !jobs.current.has(job.key)) return stop()
                    if (isPageHidden()) return arm()
                    settleFailed(job, translate('The connection was interrupted. Please try again.'))
                    publish()
                },
                getConfirmationDeadline({ now, savedAt: job.savedAt }) - now
            )
        }
        arm()
    }

    const run = job => {
        if (job.running || job.userId !== owner.current) return
        job.stopConfirming?.()
        job.running = true
        job.dispatched = false
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
                    // Resolve in the project the message was written in, even if the
                    // user switches project while it waits behind earlier sends (AT-2903).
                    const thread = resolveConversation ? await resolveConversation(job.thread?.projectId) : conversation
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
                if (!job.locallySaved && hasNewAttachments(job.text)) {
                    // Keep successful uploads on the job so retry only uploads the
                    // remaining files, in the authoritative conversation's project.
                    job.text = await updateNewAttachmentsData(thread.projectId, job.text)
                    if (!isActive()) return null
                    publish()
                    if (hasNewAttachments(job.text)) throw new Error(translate('Task attachment upload failed'))
                }
                // Capture context at submission time, before the user opens another page.
                await getDb()
                    .doc(`chatObjects/${thread.projectId}/chats/${thread.id}`)
                    .update({ annaPageContext: job.context })
                if (!isActive()) return null
                if (!job.locallySaved) {
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
                        thread.assistantId,
                        null,
                        // The run is started below, but the comment still records it so the server can
                        // start it if this page goes away before the request is sent.
                        { id: job.id, created: job.created, requestsAssistantRun: true }
                    )
                    if (!job.id) throw new Error(translate('Your message could not be sent. Please try again.'))
                    job.locallySaved = true
                    job.savedAt = Date.now()
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
                await flushAnnaActivityContext(job.userId)
                if (!isActive()) return null
                job.dispatched = true
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
                const reply = replyFor(job)
                if (job.dispatched && replyConfirmsProcessing(reply)) {
                    // The answer is already in the chat; how the response got lost is irrelevant.
                    job.status = 'sent'
                    job.error = ''
                } else if (job.dispatched && isConnectionLoss(failure)) {
                    // Never surface the SDK's bare "internal" for a lost connection.
                    if (reply === REPLY_FAILED)
                        settleFailed(job, translate('The assistant could not answer this message. Please try again.'))
                    else confirm(job)
                } else {
                    job.status = 'failed'
                    job.error = failure.message || translate('Your message could not be sent. Please try again.')
                }
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
            id: getId(),
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
        // A message the server is already answering must never be submitted twice.
        if (job?.status === 'failed' && !replyConfirmsProcessing(replyFor(job))) run(job)
    }
    const acknowledge = useCallback(
        (projectId, chatId, ids, threadReplies = {}) => {
            replies.current.set(threadKey(projectId, chatId), threadReplies)
            let changed = false
            jobs.current.forEach((job, key) => {
                if (job.thread?.projectId !== projectId || job.thread?.id !== chatId) return
                if (ids.includes(job.id)) job.acknowledged = true
                const reply = threadReplies[job.id]
                if (!job.running && job.dispatched && (job.status === 'confirming' || job.status === 'failed')) {
                    if (replyConfirmsProcessing(reply)) {
                        settleProcessed(job)
                        changed = true
                    } else if (reply === REPLY_FAILED && job.status === 'confirming') {
                        // The run really failed; its reason is in the assistant's reply above.
                        settleFailed(job, translate('The assistant could not answer this message. Please try again.'))
                        changed = true
                    }
                }
                if (job.status === 'sent' && job.acknowledged && jobs.current.has(key)) {
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
