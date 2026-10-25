import { createDescriptionAutosave, getDescriptionDraft } from './descriptionAutosave'

const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

describe('description autosave scheduling and recovery', () => {
    let upload, save, draft
    beforeEach(() => {
        jest.useFakeTimers()
        upload = jest.fn(async text => text)
        save = jest.fn(async () => {})
        draft = createDescriptionAutosave({ initialText: 'original', upload, save })
    })
    afterEach(() => jest.useRealTimers())

    it('does not save unchanged content, including an edit reverted before debounce', async () => {
        draft.change('temporary')
        draft.change('original')
        await draft.flush()
        expect(save).not.toHaveBeenCalled()
        expect(draft.pending).toBe(false)
    })

    it('persists clearing the description', async () => {
        draft.change('')
        await draft.flush()
        expect(save).toHaveBeenCalledWith('', 'original')
        expect(draft.pending).toBe(false)
    })

    it('waits for upload completion and backend acknowledgement before reporting saved', async () => {
        const attachment = deferred()
        const write = deferred()
        upload.mockReturnValueOnce(attachment.promise)
        save.mockReturnValueOnce(write.promise)
        draft.change('image', true)
        await Promise.resolve()
        expect(save).not.toHaveBeenCalled()
        attachment.resolve('remote image')
        await Promise.resolve()
        await Promise.resolve()
        expect(save).toHaveBeenCalledWith('remote image', 'original')
        expect(draft.snapshot().status).toBe('saving')
        write.resolve()
        await draft.flush()
        expect(draft.snapshot().status).toBe('saved')
    })

    it('serializes newer edits after an in-flight save and uses the previous saved text', async () => {
        const write = deferred()
        save.mockReturnValueOnce(write.promise)
        draft.change('first', true)
        await Promise.resolve()
        await Promise.resolve()
        draft.change('latest', true)
        expect(save).toHaveBeenCalledTimes(1)
        write.resolve()
        await draft.flush()
        expect(save.mock.calls).toEqual([
            ['first', 'original'],
            ['latest', 'first'],
        ])
        expect(draft.pending).toBe(false)
    })

    it('keeps the newest text when an older save fails and retries that newest text', async () => {
        const write = deferred()
        save.mockReturnValueOnce(write.promise)
        draft.change('first', true)
        await Promise.resolve()
        draft.change('latest')
        write.reject(new Error('failed'))
        await draft.flush()
        expect(draft.snapshot()).toMatchObject({ text: 'latest', status: 'error', pending: true })
        await draft.flush()
        expect(save).toHaveBeenLastCalledWith('latest', 'original')
    })

    it('never persists local image URLs when upload fails', async () => {
        upload.mockRejectedValueOnce(new Error('upload failed'))
        draft.change('blob:image', true)
        await draft.flush()
        expect(save).not.toHaveBeenCalled()
        expect(draft.snapshot()).toMatchObject({ text: 'blob:image', status: 'error' })
    })

    it('reuses successful upload tokens after a failed write and subsequent typing', async () => {
        upload.mockImplementation(async (text, tokens) => {
            if (text.includes('blob:image')) tokens.set('blob:image', 'https://remote/image')
            return text.replace('blob:image', 'https://remote/image')
        })
        save.mockRejectedValueOnce(new Error('write failed'))
        draft.change('blob:image', true)
        await draft.flush()
        expect(draft.snapshot().text).toBe('https://remote/image')
        draft.change('blob:image new text')
        await draft.flush()
        expect(upload).toHaveBeenLastCalledWith('https://remote/image new text', expect.any(Map))
        expect(save).toHaveBeenLastCalledWith('https://remote/image new text', 'original')
    })

    it('debounces typing beside an image whose local editor token was already uploaded', async () => {
        upload.mockImplementation(async (text, tokens) => {
            tokens.set('blob:image', 'https://remote/image')
            return text.replace('blob:image', 'https://remote/image')
        })
        const isNew = value => value.includes('blob:image')
        draft.change('blob:image', isNew)
        await draft.flush()
        draft.change('blob:image edited', isNew)
        await Promise.resolve()
        expect(save).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(999)
        expect(save).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(1)
        expect(save).toHaveBeenLastCalledWith('https://remote/image edited', 'https://remote/image')
    })

    it('ignores snapshot echoes while dirty, then accepts external changes when clean', async () => {
        draft.change('local')
        expect(draft.receiveRemote('external')).toBe(false)
        expect(draft.snapshot().text).toBe('local')
        await draft.flush()
        expect(draft.receiveRemote('external')).toBe(true)
        expect(draft.snapshot().text).toBe('external')
        expect(save).toHaveBeenCalledTimes(1)
    })

    it('flushes on editor teardown and retains a failed draft across remounts', async () => {
        const options = { initialText: 'original', upload, save }
        const cached = getDescriptionDraft('retained', options)
        const unsubscribe = cached.subscribe(jest.fn())
        save.mockRejectedValueOnce(new Error('write failed'))
        cached.change('unsaved image')
        unsubscribe()
        await cached.flush()
        const restored = getDescriptionDraft('retained', options)
        expect(restored).toBe(cached)
        expect(restored.snapshot().text).toBe('unsaved image')
        const subscribeAgain = restored.subscribe(jest.fn())
        await restored.flush()
        subscribeAgain()
        expect(getDescriptionDraft('retained', options)).not.toBe(cached)
        const cleanup = getDescriptionDraft('retained', options).subscribe(jest.fn())
        cleanup()
    })

    it('warns on browser close while a detached draft is unsaved', async () => {
        save.mockRejectedValue(new Error('offline'))
        const cached = getDescriptionDraft('close-warning', { initialText: '', upload, save })
        const unsubscribe = cached.subscribe(jest.fn())
        cached.change('unsaved')
        unsubscribe()
        await cached.flush()
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        await cached.flush()
        save.mockResolvedValue(undefined)
        await cached.flush()
        const cleanEvent = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(cleanEvent)
        expect(cleanEvent.defaultPrevented).toBe(false)
    })
})
