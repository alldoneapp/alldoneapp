import { queueNoteUpload } from './noteUploadQueue'
import {
    registerPendingNoteUpload,
    clearPendingNoteUpload,
    hasPendingNoteUpload,
    getPendingNoteUploadRevision,
    clearAllPendingNoteUploads,
} from './pendingNoteUploads'

it('serializes close/reopen uploads to one Storage object, allowing unrelated notes in parallel', async () => {
    const order = []
    let release
    const first = queueNoteUpload('p', 'n', () => {
        order.push('first')
        return new Promise(r => {
            release = r
        })
    })
    const second = queueNoteUpload('p', 'n', () => order.push('second'))
    await queueNoteUpload('p', 'other', () => order.push('other'))
    expect(order).toEqual(['first', 'other'])
    release()
    await first
    await second
    expect(order).toEqual(['first', 'other', 'second'])
})
it('a rejected upload does not block the next snapshot', async () => {
    const first = queueNoteUpload('p', 'n', () => Promise.reject(new Error('offline')))
    const second = queueNoteUpload('p', 'n', () => true)
    await expect(first).rejects.toThrow('offline')
    await expect(second).resolves.toBe(true)
})
it('an older upload acknowledgement cannot erase the marker for a later offline edit', () => {
    clearAllPendingNoteUploads()
    registerPendingNoteUpload('p', 'n')
    const first = getPendingNoteUploadRevision('n')
    registerPendingNoteUpload('p', 'n')
    const second = getPendingNoteUploadRevision('n')
    expect(second).not.toBe(first)
    clearPendingNoteUpload('n', first)
    expect(hasPendingNoteUpload('n')).toBe(true)
    clearPendingNoteUpload('n', second)
    expect(hasPendingNoteUpload('n')).toBe(false)
})
