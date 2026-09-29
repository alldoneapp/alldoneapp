// A lost acknowledgement or concurrent tab must not duplicate the comment's
// counters/notifications. The comment is the receipt, written in the same
// transaction as its metadata. Never clear the outbox on a local cache echo.
export const commitCommentOnce = (db, { commentPath, chatPath, isActive, stageWrites }) =>
    db.runTransaction(async transaction => {
        if (!isActive()) throw Object.assign(new Error('Account changed'), { code: 'cancelled' })
        const commentRef = db.doc(commentPath)
        const chatRef = db.doc(chatPath)
        const [comment, chat] = await Promise.all([transaction.get(commentRef), transaction.get(chatRef)])
        if (!isActive()) throw Object.assign(new Error('Account changed'), { code: 'cancelled' })
        if (comment.exists) return false
        await stageWrites(transaction, chat.exists ? chat.data() : null)
        if (!isActive()) throw Object.assign(new Error('Account changed'), { code: 'cancelled' })
        return true
    })
