import React, { useEffect, useRef, useState } from 'react'
import MessageItemBody from '../ChatsView/ChatDV/EditorView/MessageItemBody'
import VmInteractionCard from '../ChatsView/ChatDV/EditorView/VmInteractionCard'
import StopAssistantRunButton from '../ChatsView/ChatDV/EditorView/StopAssistantRunButton'
import { getDb } from '../../utils/backends/firestore'
import { translate } from '../../i18n/TranslationService'
import { vmJobPath } from './useAnnaVmJobs'

export const vmStatusLabel = status => {
    switch (status) {
        case 'queued':
            return translate('vm_workspace_queued')
        case 'pending':
            return translate('vm_workspace_starting')
        case 'initiated':
        case 'running':
            return translate('vm_workspace_running')
        case 'awaiting_user':
            return translate('vm_workspace_awaiting')
        case 'cancel_requested':
            return translate('vm_workspace_stopping')
        case 'completed':
            return translate('vm_workspace_completed')
        case 'failed':
        case 'expired':
            return translate('vm_workspace_failed')
        case 'cancelled':
        case 'interrupted':
            return translate('vm_workspace_stopped')
        default:
            return translate('vm_workspace_loading')
    }
}

export default function AnnaVmWorkspace({ job, active }) {
    const [message, setMessage] = useState(null)
    const [error, setError] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const scroller = useRef(null)
    const following = useRef(true)
    useEffect(() => {
        if (!active || !job.commentId) return
        let disposed = false
        setError(false)
        const stop = getDb()
            .doc(`chatComments/${job.projectId}/${job.objectType}/${job.objectId}/comments/${job.commentId}`)
            .onSnapshot(
                snapshot => {
                    if (disposed) return
                    const next = snapshot.exists ? snapshot.data() : null
                    if (next?.assistantRun?.runId === job.id) {
                        setMessage(next)
                        setError(false)
                    } else {
                        setMessage(null)
                        setError(true)
                    }
                },
                () => {
                    if (disposed) return
                    setMessage(null)
                    setError(true)
                }
            )
        return () => {
            disposed = true
            stop()
        }
    }, [active, job.id, job.projectId, job.objectType, job.objectId, job.commentId, attempt])
    useEffect(() => {
        if (active && following.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
    }, [active, message])
    const status =
        ['queued', 'pending'].includes(job.status) && message?.assistantRun?.status === 'running'
            ? job.status
            : message?.assistantRun?.status || job.status
    const live = ['queued', 'pending', 'initiated', 'running', 'awaiting_user', 'cancel_requested'].includes(status)
    const messageProps = {
        messageId: job.commentId,
        projectId: job.projectId,
        objectType: job.objectType,
        chat: { id: job.objectId },
        creatorData: { isAssistant: true },
        commentText: message?.commentText || '',
        assistantRun: message?.assistantRun,
        isLoading: live,
    }
    return (
        <div className="anna-vm-workspace">
            <div className="anna-vm-heading">
                <div className="anna-vm-identity">
                    <span className="anna-vm-status" role="status">
                        {vmStatusLabel(status)}
                    </span>
                    <h2>{job.title}</h2>
                    <div className="anna-muted">{[job.projectName, job.model].filter(Boolean).join(' · ')}</div>
                </div>
                <a className="anna-vm-task-link" href={vmJobPath(job)}>
                    {translate('vm_workspace_open_thread')}
                </a>
            </div>
            <div
                className="anna-vm-activity"
                ref={scroller}
                tabIndex={0}
                aria-label={translate('vm_workspace_activity')}
                onScroll={event => {
                    const node = event.currentTarget
                    following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
                }}
            >
                {error ? (
                    <div className="anna-error" role="alert">
                        {translate('vm_workspace_unavailable')}
                        <button onClick={() => setAttempt(value => value + 1)}>{translate('Retry')}</button>
                    </div>
                ) : message ? (
                    live ? (
                        <>
                            <div className="anna-vm-terminal" aria-label={translate('vm_workspace_terminal')}>
                                <div className="anna-vm-terminal-label">{translate('vm_workspace_activity')}</div>
                                <pre>{message.commentText}</pre>
                                {['running', 'initiated', 'pending'].includes(status) && (
                                    <span className="anna-vm-cursor" aria-hidden="true">
                                        ▍
                                    </span>
                                )}
                            </div>
                            <div className="anna-vm-actions">
                                {status === 'awaiting_user' && (
                                    <VmInteractionCard
                                        key={message.assistantRun.interaction?.requestId}
                                        {...messageProps}
                                        objectId={job.objectId}
                                        commentId={job.commentId}
                                    />
                                )}
                                <StopAssistantRunButton
                                    {...messageProps}
                                    objectId={job.objectId}
                                    commentId={job.commentId}
                                />
                            </div>
                        </>
                    ) : (
                        <MessageItemBody {...messageProps} />
                    )
                ) : (
                    <div className="anna-empty" role="status">
                        {translate(job.commentId ? 'vm_workspace_loading' : 'vm_workspace_no_progress')}
                    </div>
                )}
            </div>
        </div>
    )
}
