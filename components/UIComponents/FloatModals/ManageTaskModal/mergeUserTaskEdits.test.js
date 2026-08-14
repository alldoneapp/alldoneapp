import { mergeUserTaskEdits } from './mergeUserTaskEdits'

const remoteTask = {
    id: 'task-1',
    name: 'Original title',
    extendedName: 'Original title',
    dueDate: 1786120208285,
    userId: 'user-a',
    commentsCount: 3,
}

const localTask = {
    ...remoteTask,
    name: 'What the user is typing',
    extendedName: 'What the user is typing',
}

describe('mergeUserTaskEdits - AT-2203: a background update must not revert a typed title', () => {
    it('keeps the typed title when the task document changes underneath', () => {
        const incoming = { ...remoteTask, commentsCount: 4 }

        const merged = mergeUserTaskEdits(incoming, localTask, true)

        expect(merged.extendedName).toBe('What the user is typing')
        expect(merged.name).toBe('What the user is typing')
    })

    it('still takes every other field from the remote document', () => {
        const incoming = { ...remoteTask, commentsCount: 9, dueDate: 1786999999999, userId: 'user-b' }

        const merged = mergeUserTaskEdits(incoming, localTask, true)

        expect(merged.commentsCount).toBe(9)
        expect(merged.dueDate).toBe(1786999999999)
        expect(merged.userId).toBe('user-b')
    })

    it('does not mutate the incoming task', () => {
        const incoming = { ...remoteTask }

        mergeUserTaskEdits(incoming, localTask, true)

        expect(incoming.extendedName).toBe('Original title')
    })

    it('accepts a remote title change when the user has not touched the title', () => {
        const incoming = { ...remoteTask, extendedName: 'Renamed by an assistant', name: 'Renamed by an assistant' }

        const merged = mergeUserTaskEdits(incoming, localTask, false)

        expect(merged.extendedName).toBe('Renamed by an assistant')
    })

    it('is a no-op without a local task to preserve', () => {
        const incoming = { ...remoteTask }

        expect(mergeUserTaskEdits(incoming, null, true)).toBe(incoming)
        expect(mergeUserTaskEdits(incoming, undefined, true)).toBe(incoming)
    })

    it('tolerates a missing remote task', () => {
        expect(mergeUserTaskEdits(null, localTask, true)).toBeNull()
    })
})
