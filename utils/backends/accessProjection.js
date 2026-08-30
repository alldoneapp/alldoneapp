// These fields are derived and maintained by the Admin SDK projection triggers.
// Firestore rules intentionally reject client creates/updates that include them,
// so cross-project copies must let the destination trigger rebuild them against
// the destination project's membership.
export const SERVER_ACCESS_PROJECTION_FIELDS = [
    'readerIds',
    'roleIdsVisibleTo',
    'followedByVisibleTo',
    'followedReaderIds',
    'backlinkIdsVisibleTo',
]

export const withoutServerAccessProjection = data => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data

    const sanitized = { ...data }
    SERVER_ACCESS_PROJECTION_FIELDS.forEach(field => delete sanitized[field])
    return sanitized
}
