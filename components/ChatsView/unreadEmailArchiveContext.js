import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import useLinkedEmailArchive from './ChatDV/useLinkedEmailArchive'

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
 */
export const collectUnreadLinkedEmails = (sources, projectId) => {
    const linkedEmails = new Map()
    Object.values(sources || {}).forEach(source => {
        if (!source) return
        if (projectId && source.projectId !== projectId) return
        ;(source.linkedEmails || []).forEach(linkedEmail => {
            if (linkedEmail?.key && !linkedEmails.has(linkedEmail.key)) linkedEmails.set(linkedEmail.key, linkedEmail)
        })
    })
    return [...linkedEmails.values()]
}

const sameRegistration = (previous, projectId, linkedEmails) =>
    !!previous &&
    previous.projectId === projectId &&
    previous.linkedEmails.length === linkedEmails.length &&
    previous.linkedEmails.every((linkedEmail, index) => linkedEmail.key === linkedEmails[index].key)

export function UnreadEmailArchiveProvider({ children }) {
    const archive = useLinkedEmailArchive()
    const [sources, setSources] = useState({})

    const registerUnreadLinkedEmails = useCallback((sourceKey, projectId, linkedEmails = []) => {
        setSources(current =>
            // A row re-renders on every message change, so an unconditional write here would loop
            // through the provider's state and back into the row. Only a changed set of email keys
            // is a change worth publishing.
            sameRegistration(current[sourceKey], projectId, linkedEmails)
                ? current
                : { ...current, [sourceKey]: { projectId, linkedEmails } }
        )
    }, [])

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
export function useRegisterUnreadLinkedEmails(sourceKey, projectId, linkedEmails) {
    const context = useContext(UnreadEmailArchiveContext)
    const register = context?.registerUnreadLinkedEmails
    const unregister = context?.unregisterUnreadLinkedEmails

    const linkedEmailsRef = useRef(linkedEmails)
    linkedEmailsRef.current = linkedEmails || []

    // The identity of the array changes on every render (it is derived from the messages), so the
    // effect is keyed on the email keys themselves rather than on the array.
    const signature = (linkedEmails || []).map(linkedEmail => linkedEmail.key).join('|')

    useEffect(() => {
        if (register) register(sourceKey, projectId, linkedEmailsRef.current)
    }, [register, sourceKey, projectId, signature])

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
