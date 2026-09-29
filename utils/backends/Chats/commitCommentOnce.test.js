import { commitCommentOnce } from './commitCommentOnce'

it('commits the comment and its count together and skips both on replay after a lost acknowledgement', async () => {
    const docs = new Map()
    const staged = []
    const db = {
        doc: path => path,
        runTransaction: async body => {
            const result = await body({
                get: async path => ({ exists: docs.has(path), data: () => docs.get(path) }),
                set: (p, v) => staged.push([p, v]),
            })
            staged.splice(0).forEach(([p, v]) => docs.set(p, v))
            return result
        },
    }
    const stageWrites = jest.fn(async transaction => {
        transaction.set('comment', { text: 'kept' })
        transaction.set('chat', { amount: 1 })
    })
    const options = { commentPath: 'comment', chatPath: 'chat', isActive: () => true, stageWrites }
    expect(await commitCommentOnce(db, options)).toBe(true)
    expect(await commitCommentOnce(db, options)).toBe(false)
    expect(stageWrites).toHaveBeenCalledTimes(1)
    expect(docs.get('chat').amount).toBe(1)
})

it('does not write when the account changes during the transaction reads', async () => {
    let active = true
    const stageWrites = jest.fn()
    const db = {
        doc: p => p,
        runTransaction: body =>
            body({
                get: async () => {
                    active = false
                    return { exists: false }
                },
            }),
    }
    await expect(
        commitCommentOnce(db, { commentPath: 'c', chatPath: 'h', isActive: () => active, stageWrites })
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(stageWrites).not.toHaveBeenCalled()
})
