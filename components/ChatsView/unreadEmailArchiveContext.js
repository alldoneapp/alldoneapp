import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import useLinkedEmailArchive from './ChatDV/useLinkedEmailArchive'

// Lazy, like the archive action itself: the sync reaches the Firebase client, and a row rendered on
// its own (or in a unit test) must not have to load it.
const syncEmailCommentsReadState = (...args) =>
    require('../../utils/backends/EmailLine/emailCommentReadSync').syncEmailCommentsReadState(...args)

/**
 * The chat list's shared view of "which linked emails are currently previewed, and where".
 *
 * The per-message archive button (AT-2256) lives inside a single previewed message and only ever
 * needs its own email. The bulk buttons added on top of it - "Archive emails" on a project line and
 * "Archive all emails" on the All Projects line - need the opposite: every email the previews of a
 * whole project, or of every project, are currently showing. That set only exists inside the row
 * components, because each row subscribes to its own topic's unread comments, so the rows publish
 * it here and the header buttons read it back.
 *
 * Two things this context is deliberately responsible for:
 *
 * - **One archive state for the whole screen.** It holds a single `useLinkedEmailArchive` that the
 *   rows and the header buttons share, so a bulk archive immediately flips every affected message's
 *   own button to "Archived", and an email already archived from a message is never sent again by
 *   the bulk action. Without the shared instance the two sides would each keep an optimistic state
 *   the other could not see.
 * - **Deduplication.** The same email can be previewed by more than one topic (the same Gmail
 *   message linked into two chats) and, in All Projects, by more than one project section. Emails
 *   are therefore collected through a Map keyed by the linked email's `key`
 *   (`connectionProjectId:messageId`), so a bulk archive sends each email exactly once.
 *
 * It changes nothing about unread state: registering a preview is a read, and archiving acts on the
 * mailbox, never on the chat's notification docs.
 */
const UnreadEmailArchiveContext = createContext(null)

/**
 * Collects the registered previews into one deduplicated list of linked emails, optionally narrowed
 * to a single project. `projectId` omitted means "every project", which is what the All Projects
 * line archives.
 *
 * `field` picks WHICH set of a registration is collected: `linkedEmails` are the ones a row is
 * actually previewing (what the bulk archive buttons act on - archiving mail the user cannot see
 * would be a different, sharper action), while `unreadLinkedEmails` is every unread email of the
 * row, including the ones the preview cap hides. Only the read sync uses the second: a "Daily
 * emails" topic collects a whole day into one row, so reconciling just the newest five against the
 * mailbox would leave the rest permanently unread (AT-2376).
 */
export const collectUnreadLinkedEmails = (sources, projectId, field = 'linkedEmails') => {
    const linkedEmails = new Map()
    Object.values(sources || {}).forEach(source => {
        if (!source) return
        if (projectId && source.projectId !== projectId) return
        ;(source[field] || []).forEach(linkedEmail => {
            if (!linkedEmail?.key) return
            const existing = linkedEmails.get(linkedEmail.key)
            if (!existing) {
                linkedEmails.set(linkedEmail.key, {
                    ...linkedEmail,
                    ...((linkedEmail.commentRefs || []).length ? { commentRefs: [...linkedEmail.commentRefs] } : {}),
                })
                return
            }
            if (!(linkedEmail.commentRefs || []).length) return
            existing.commentRefs = existing.commentRefs || []
            linkedEmail.commentRefs.forEach(ref => {
                if (
                    ref?.projectId &&
                    ref?.commentId &&
                    !existing.commentRefs.some(
                        existingRef =>
                            existingRef.projectId === ref.projectId && existingRef.commentId === ref.commentId
                    )
                ) {
                    existing.commentRefs.push(ref)
                }
            })
        })
    })
    return [...linkedEmails.values()]
}

const sameLinkedEmails = (previous, next) =>
    Array.isArray(previous) &&
    previous.length === next.length &&
    previous.every((linkedEmail, index) => {
        const nextLinkedEmail = next[index]
        return (
            linkedEmail.key === nextLinkedEmail.key &&
            (linkedEmail.commentId || '') === (nextLinkedEmail.commentId || '') &&
            (linkedEmail.projectId || '') === (nextLinkedEmail.projectId || '')
        )
    })

const sameRegistration = (previous, projectId, linkedEmails, unreadLinkedEmails) =>
    !!previous &&
    previous.projectId === projectId &&
    sameLinkedEmails(previous.linkedEmails, linkedEmails) &&
    sameLinkedEmails(previous.unreadLinkedEmails, unreadLinkedEmails)

/**
 * Reconciles the previewed unread emails against the mailbox (AT-2376) whenever that set changes,
 * and again whenever the tab becomes visible — the "I archived it in Gmail and came back" case,
 * which by definition happens without anything in the app changing. The sync itself is throttled
 * per message and swallows every failure, so this is deliberately a fire-and-forget effect.
 */
export function useEmailCommentReadSync(sources) {
    const linkedEmails = useMemo(() => collectUnreadLinkedEmails(sources, undefined, 'unreadLinkedEmails'), [sources])
    const linkedEmailsRef = useRef(linkedEmails)
    linkedEmailsRef.current = linkedEmails
    const signature = linkedEmails.map(linkedEmail => linkedEmail.key).join('|')

    useEffect(() => {
        if (!signature) return
        syncEmailCommentsReadState(linkedEmailsRef.current)
    }, [signature])

    useEffect(() => {
        if (typeof document === 'undefined' || !document.addEventListener) return undefined
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') return
            if (linkedEmailsRef.current.length === 0) return
            // Coming back from Gmail is the one moment the throttle would get in the way.
            syncEmailCommentsReadState(linkedEmailsRef.current, { force: true })
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    }, [])
}

export function UnreadEmailArchiveProvider({ children }) {
    const archive = useLinkedEmailArchive()
    const [sources, setSources] = useState({})

    // Gmail → Alldone read sync (AT-2376). The rows have already resolved exactly the set this
    // needs — the emails behind the unread comments currently on screen — so reconciling them
    // against the mailbox here costs no extra Firestore reads and needs no new data model. An
    // email the user read or archived in Gmail itself clears its Alldone comment on the next pass.
    useEmailCommentReadSync(sources)

    const registerUnreadLinkedEmails = useCallback(
        (sourceKey, projectId, linkedEmails = [], unreadLinkedEmails = linkedEmails) => {
            setSources(current =>
                // A row re-renders on every message change, so an unconditional write here would
                // loop through the provider's state and back into the row. Only a changed set of
                // email keys is a change worth publishing.
                sameRegistration(current[sourceKey], projectId, linkedEmails, unreadLinkedEmails)
                    ? current
                    : { ...current, [sourceKey]: { projectId, linkedEmails, unreadLinkedEmails } }
            )
        },
        []
    )

    const unregisterUnreadLinkedEmails = useCallback(sourceKey => {
        setSources(current => {
            if (!current[sourceKey]) return current
            const { [sourceKey]: removed, ...rest } = current
            return rest
        })
    }, [])

    const value = { archive, sources, registerUnreadLinkedEmails, unregisterUnreadLinkedEmails }

    return <UnreadEmailArchiveContext.Provider value={value}>{children}</UnreadEmailArchiveContext.Provider>
}

export function useUnreadEmailArchiveContext() {
    return useContext(UnreadEmailArchiveContext)
}

/**
 * Publishes the linked emails one preview is showing. Outside a provider (the chat list is not the
 * only place a preview can be mounted, and most unit tests render the row on its own) this is a
 * no-op, and the row keeps its own archive state.
 */
export function useRegisterUnreadLinkedEmails(sourceKey, projectId, linkedEmails, unreadLinkedEmails) {
    const context = useContext(UnreadEmailArchiveContext)
    const register = context?.registerUnreadLinkedEmails
    const unregister = context?.unregisterUnreadLinkedEmails

    const linkedEmailsRef = useRef(linkedEmails)
    linkedEmailsRef.current = linkedEmails || []
    const unreadLinkedEmailsRef = useRef(unreadLinkedEmails)
    unreadLinkedEmailsRef.current = unreadLinkedEmails || linkedEmails || []

    // The identity of the array changes on every render (it is derived from the messages), so the
    // effect is keyed on the email keys themselves rather than on the array.
    const signature = (linkedEmails || []).map(linkedEmail => linkedEmail.key).join('|')
    const unreadSignature = unreadLinkedEmailsRef.current.map(linkedEmail => linkedEmail.key).join('|')

    useEffect(() => {
        if (register) register(sourceKey, projectId, linkedEmailsRef.current, unreadLinkedEmailsRef.current)
    }, [register, sourceKey, projectId, signature, unreadSignature])

    useEffect(() => {
        if (!unregister) return undefined
        return () => unregister(sourceKey)
    }, [unregister, sourceKey])
}

/**
 * What a bulk archive button needs: the deduplicated emails in its scope plus the screen's shared
 * archive state. Returns null when there is no provider, which is how the button knows to render
 * nothing at all.
 */
export function useUnreadLinkedEmailsScope(projectId) {
    const context = useContext(UnreadEmailArchiveContext)
    const sources = context?.sources
    const linkedEmails = useMemo(() => collectUnreadLinkedEmails(sources, projectId), [sources, projectId])

    if (!context) return null

    return { linkedEmails, archive: context.archive }
}

export default UnreadEmailArchiveContext
