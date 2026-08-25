import { useState } from 'react'

import { translate } from '../../../i18n/TranslationService'
import { archiveAndMarkReadLinkedEmails } from './linkedEmailActions'

/**
 * The archive-a-linked-email action plus the optimistic state its button renders from.
 *
 * Lifted out of ChatBoard so the chat list's unread previews (AT-2256) archive through exactly the
 * same call and the same in-flight/archived semantics as the thread, instead of a second copy that
 * would drift. Archiving also marks the matching Alldone chat comments as read (AT-2298) without
 * changing the mailbox read/unread state. The state is deliberately per-mount, as it always was:
 * it is the *optimistic* echo of an action this view just performed (spinner, then a persistent
 * "Archived"), not a cache of the mailbox. Gmail's own state is the truth, and it is re-read the
 * next time the data loads.
 *
 * Consumers get the raw key arrays too, because ChatBoard drives its "Archive all emails" button
 * and its unarchived-email count off them.
 *
 * Since AT-2424 the "archived" half is OPTIMISTIC: the key is marked archived on the press and
 * only removed again if the archive fails. The action itself clears the comment's unread state
 * immediately, so a button that kept spinning for the 4-8s Gmail takes would be the last thing on
 * screen still claiming the work was not done. `archivingEmailKeys` stays the honest in-flight
 * set - ChatBoard uses it to keep two bulk runs from overlapping - which is why the renderers
 * check `archived` BEFORE `archiving`.
 */
export default function useLinkedEmailArchive() {
    const [archivingEmailKeys, setArchivingEmailKeys] = useState([])
    const [archivedEmailKeys, setArchivedEmailKeys] = useState([])
    // Which emails failed to archive, kept HERE rather than in the button (AT-2424). Clearing the
    // unread state optimistically unmounts the previewed rows, and with them the bulk button - so
    // a failure arriving 4-8s later would land on a component that no longer exists, and the
    // restored emails would reappear with nothing saying why. This state lives in the provider,
    // which outlives every row, so the remounted button can still report it.
    const [failedEmailKeys, setFailedEmailKeys] = useState([])

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
        setFailedEmailKeys(current => current.filter(key => !pendingKeys.includes(key)))
        // Optimistic (AT-2424): say "Archived" now, and wind it back only if the mailbox refuses.
        // The same press has already cleared the comment's unread state, so this keeps the button
        // and the list telling the same story from the first frame.
        setArchivedEmailKeys(current => [...new Set([...current, ...pendingKeys])])
        try {
            await archiveAndMarkReadLinkedEmails(pendingEmails)
            return true
        } catch (error) {
            // The action restored the unread state; the button has to come back with it, or the
            // email would reappear in the list next to a button still claiming it was archived.
            setArchivedEmailKeys(current => current.filter(key => !pendingKeys.includes(key)))
            setFailedEmailKeys(current => [...new Set([...current, ...pendingKeys])])
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
        failedEmailKeys,
        archiveLinkedEmails,
        isArchivingEmail: key => !!key && archivingEmailKeys.includes(key),
        isArchivedEmail: key => !!key && archivedEmailKeys.includes(key),
        isFailedEmail: key => !!key && failedEmailKeys.includes(key),
    }
}
