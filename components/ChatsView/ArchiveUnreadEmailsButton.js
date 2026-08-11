import React, { useState } from 'react'

import { translate } from '../../i18n/TranslationService'
import { useUnreadLinkedEmailsScope } from './unreadEmailArchiveContext'
import ProjectLineActionButton from './ProjectLineActionButton'

/**
 * Archives, in one press, every linked email the chat list is currently previewing in its scope:
 * one project when `projectId` is given (the project line), otherwise every project (the All
 * Projects line).
 *
 * It acts on exactly what is on screen - the emails behind the previewed unread messages - so it is
 * the bulk version of the per-message "Archive email" button next to it, not a mailbox-wide sweep.
 * The emails are deduplicated by the shared registry, so the same email previewed in two topics (or
 * in two projects, from the All Projects line) is archived once.
 *
 * It never touches unread state: archiving is a mailbox action, the previews stay exactly as they
 * were, and nothing is marked as read.
 *
 * Visibility doubles as the permission gate. A preview only publishes its emails when the viewer is
 * a project member (the same `SharedHelper.accessGranted` check the thread applies before showing
 * any email action), so a non-member's scope is empty and this button renders nothing.
 */
export default function ArchiveUnreadEmailsButton({ projectId, containerStyle }) {
    const scope = useUnreadLinkedEmailsScope(projectId)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(false)

    const linkedEmails = scope?.linkedEmails || []
    const archive = scope?.archive
    const pendingEmails = linkedEmails.filter(linkedEmail => !archive?.isArchivedEmail(linkedEmail.key))
    const archivingElsewhere = pendingEmails.some(linkedEmail => archive?.isArchivingEmail(linkedEmail.key))
    const completed = linkedEmails.length > 0 && pendingEmails.length === 0
    const disabled = loading || archivingElsewhere || pendingEmails.length === 0
    const label = projectId ? 'Archive emails' : 'Archive all emails'

    const archiveEmails = async () => {
        if (disabled) return

        setLoading(true)
        setError(false)
        // The hook reports failure instead of alerting, because this button shows the failure
        // itself - an alert on top of a red "try again" row would say the same thing twice.
        const archived = await archive.archiveLinkedEmails(pendingEmails, { notifyOnError: false })
        if (!archived) setError(true)
        setLoading(false)
    }

    // Nothing previewed in this scope has an email behind it: no button at all, rather than a
    // permanently disabled one on every chat header.
    if (linkedEmails.length === 0) return null

    return (
        <ProjectLineActionButton
            icon={completed ? 'check' : 'archive'}
            label={translate(error ? 'try again' : completed ? 'Archived' : label)}
            // The icon-only variant has no room for "try again"/"Archived", so the state has to be
            // readable from the accessible name itself - hence the full sentence on failure, and
            // "Archived" rather than the base label once the check icon has replaced the box.
            accessibilityLabel={translate(
                error ? "Emails couldn't be archived. Try again" : completed ? 'Archived' : label
            )}
            loading={loading || archivingElsewhere}
            error={error}
            disabled={disabled}
            onPress={archiveEmails}
            containerStyle={containerStyle}
        />
    )
}
