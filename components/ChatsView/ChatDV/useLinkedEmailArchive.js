import { useState } from 'react'

import { performEmailLineAction } from '../../../utils/backends/EmailLine/emailLineBackend'
import { translate } from '../../../i18n/TranslationService'
import { groupLinkedEmailsByConnection } from './linkedEmailActions'

/**
 * The archive-a-linked-email action plus the optimistic state its button renders from.
 *
 * Lifted out of ChatBoard so the chat list's unread previews (AT-2256) archive through exactly the
 * same call and the same in-flight/archived semantics as the thread, instead of a second copy that
 * would drift. The state is deliberately per-mount, as it always was: it is the *optimistic* echo
 * of an action this view just performed (spinner, then a persistent "Archived"), not a cache of the
 * mailbox. Gmail's own state is the truth, and it is re-read the next time the data loads.
 *
 * Consumers get the raw key arrays too, because ChatBoard drives its "Archive all emails" button
 * and its unarchived-email count off them.
 */
export default function useLinkedEmailArchive() {
    const [archivingEmailKeys, setArchivingEmailKeys] = useState([])
    const [archivedEmailKeys, setArchivedEmailKeys] = useState([])

    /**
     * Archives every email that is not already archived or in flight, and reports whether that
     * succeeded. Callers that render their own failure state (the chat list's bulk buttons) pass
     * `notifyOnError: false` so the alert is not shown on top of it; the thread keeps the alert,
     * which is its only failure affordance.
     */
    const archiveLinkedEmails = async (emails, { notifyOnError = true } = {}) => {
        const pendingEmails = (emails || []).filter(
            email => email?.key && !archivedEmailKeys.includes(email.key) && !archivingEmailKeys.includes(email.key)
        )
        if (pendingEmails.length === 0) return true

        const pendingKeys = pendingEmails.map(email => email.key)
        setArchivingEmailKeys(current => [...new Set([...current, ...pendingKeys])])
        try {
            const groupedEmails = groupLinkedEmailsByConnection(pendingEmails)
            await Promise.all(
                Object.entries(groupedEmails).map(([connectionProjectId, messageIds]) =>
                    performEmailLineAction(connectionProjectId, { action: 'archive', messageIds })
                )
            )
            setArchivedEmailKeys(current => [...new Set([...current, ...pendingKeys])])
            return true
        } catch (error) {
            console.error('Failed to archive linked email', error)
            if (notifyOnError) alert(`${translate("Email couldn't be archived")}: ${error.message}`)
            return false
        } finally {
            setArchivingEmailKeys(current => current.filter(key => !pendingKeys.includes(key)))
        }
    }

    return {
        archivingEmailKeys,
        archivedEmailKeys,
        archiveLinkedEmails,
        isArchivingEmail: key => !!key && archivingEmailKeys.includes(key),
        isArchivedEmail: key => !!key && archivedEmailKeys.includes(key),
    }
}
