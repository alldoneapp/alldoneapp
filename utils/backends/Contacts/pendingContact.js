/**
 * AT-2508 - the marker for a contact that exists locally and is still on its way to Firestore.
 *
 * Deliberately a LEAF module with no imports of its own. Both the contacts list and the write
 * path need to agree on this flag, but `optimisticContactCreate.js` reaches the redux store, and
 * pulling that into `ContactsView`/`ContactListByProject` for the sake of one string drags in the
 * whole store module graph (`@hello-pangea/dnd` among others) - which broke `ContactsView.test.js`
 * the moment it was tried. Views import from here; only the write path imports the machinery.
 */

export const PENDING_CONTACT_FLAG = 'isPendingCreation'

/** Whether a contact row is a local, not-yet-stored one. Null-safe: list entries can be holes. */
export const isPendingContact = contact => !!contact && !!contact[PENDING_CONTACT_FLAG]
