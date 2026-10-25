/**
 * A person link's id is shared by project members and copied contacts, but Firestore stores the
 * two kinds in different collections. The project document's `userIds` is the authorization
 * authority, so it is also the only safe way to select the namespace. Probing `users/{id}` first
 * is not a valid existence check: strict user rules deny that read for contact ids before a
 * contact fallback can run.
 */
export const getPeopleDocumentDescriptor = (projectId, personId, projectUserIds) => {
    const isMember = Array.isArray(projectUserIds) && projectUserIds.includes(personId)
    return {
        isMember,
        path: isMember ? `users/${personId}` : `projectsContacts/${projectId}/contacts/${personId}`,
    }
}
