// Retention belongs to the Admin SDK, outside every user's offline write queue.
// Bounded reads/writes also make duplicate delivery and concurrent cleanup safe.
const MAX_STORED_FEEDS = 200
const MAX_DELETES_PER_RUN = 200

async function trimFeedCollection(database, collectionPath) {
    const snapshot = await database
        .collection(collectionPath)
        .orderBy('lastChangeDate', 'desc')
        .limit(MAX_STORED_FEEDS + MAX_DELETES_PER_RUN)
        .get()
    const expired = snapshot.docs.slice(MAX_STORED_FEEDS)
    if (!expired.length) return 0
    const batch = database.batch()
    expired.forEach(doc => batch.delete(doc.ref))
    await batch.commit()
    return expired.length
}

module.exports = { trimFeedCollection, MAX_STORED_FEEDS, MAX_DELETES_PER_RUN }
