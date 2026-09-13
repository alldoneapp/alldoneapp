export const persistNewDayAcknowledgement = (db, userId, previousDate, date, getCurrentUserId) => {
    const ref = db.doc(`users/${userId}`)
    const assertAccount = () => {
        if (getCurrentUserId() !== userId) throw new Error('New day account changed')
    }
    // Replay must be monotonic across devices and retries of this transaction.
    // Offline the durable local confirmation remains pending until reconnect.
    return db.runTransaction(async transaction => {
        assertAccount()
        const snapshot = await transaction.get(ref)
        assertAccount()
        if (Number(snapshot.data()?.statisticsModalDate || 0) >= date) return
        transaction.update(ref, { statisticsModalDate: date, previousStatisticsModalDate: previousDate })
    })
}
