import React from 'react'

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
 * Archiving those emails also marks the matching Alldone chat comments as read (AT-2298), so they
 * leave the unread Chats list. The mailbox itself stays unread/read as it was.
 *
 * Visibility doubles as the permission gate. A preview only publishes its emails when the viewer is
 * a project member (the same `SharedHelper.accessGranted` check the thread applies before showing
 * any email action), so a non-member's scope is empty and this button renders nothing.
 */
export default function ArchiveUnreadEmailsButton({ projectId, containerStyle }) {
    const scope = useUnreadLinkedEmailsScope(projectId)

    const linkedEmails = scope?.linkedEmails || []
    const archive = scope?.archive
    const pendingEmails = linkedEmails.filter(linkedEmail => !archive?.isArchivedEmail(linkedEmail.key))
    const archivingElsewhere = pendingEmails.some(linkedEmail => archive?.isArchivingEmail(linkedEmail.key))
    // Read from the shared archive rather than from local state (AT-2424). Clearing the unread
    // state optimistically unmounts the previewed rows - and this button with them - so a failure
    // arriving seconds later has nowhere local to land. Scoping it to the emails currently pending
    // also means the row only says "try again" about emails that are actually back and retryable.
    const error = pendingEmails.some(linkedEmail => archive?.isFailedEmail(linkedEmail.key))
    const completed = linkedEmails.length > 0 && pendingEmails.length === 0
    const disabled = archivingElsewhere || pendingEmails.length === 0
    const label = projectId ? 'Archive emails' : 'Archive all emails'

    // Deliberately no local loading state (AT-2424). The shared archive marks these emails
    // archived on the press, so `completed` flips to the check mark in the same frame the rows
    // leave the unread list. Holding a spinner here for the 4-8s the mailbox round trips take
    // would be the one thing on screen still saying the bulk archive had not happened.
    const archiveEmails = () => {
        if (disabled) return

        // The hook reports failure instead of alerting, because this button shows the failure
        // itself - an alert on top of a red "try again" row would say the same thing twice. It
        // records the failed keys in the shared state, which is what `error` above reads.
        return archive.archiveLinkedEmails(pendingEmails, { notifyOnError: false })
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
            loading={archivingElsewhere}
            error={error}
            disabled={disabled}
            onPress={archiveEmails}
            containerStyle={containerStyle}
        />
    )
}
