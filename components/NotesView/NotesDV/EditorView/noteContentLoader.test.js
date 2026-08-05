import { loadNoteContentWithRetry } from './noteContentLoader'

describe('loadNoteContentWithRetry', () => {
    it('retries missing content and returns the first valid response', async () => {
        const content = new ArrayBuffer(4)
        const loadContent = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(content)
        const waitForRetry = jest.fn().mockResolvedValue()

        await expect(loadNoteContentWithRetry(loadContent, { waitForRetry })).resolves.toBe(content)
        expect(loadContent).toHaveBeenCalledTimes(2)
        expect(waitForRetry).toHaveBeenCalledWith(250)
    })

    it('accepts an empty ArrayBuffer for a genuinely blank new note', async () => {
        const content = new ArrayBuffer(0)
        const loadContent = jest.fn().mockResolvedValue(content)

        await expect(loadNoteContentWithRetry(loadContent)).resolves.toBe(content)
        expect(loadContent).toHaveBeenCalledTimes(1)
    })

    it('fails instead of converting repeated download errors into empty content', async () => {
        const error = new Error('storage unavailable')
        const loadContent = jest.fn().mockRejectedValue(error)
        const waitForRetry = jest.fn().mockResolvedValue()

        await expect(loadNoteContentWithRetry(loadContent, { attempts: 3, waitForRetry })).rejects.toBe(error)
        expect(loadContent).toHaveBeenCalledTimes(3)
        expect(waitForRetry).toHaveBeenNthCalledWith(1, 250)
        expect(waitForRetry).toHaveBeenNthCalledWith(2, 500)
    })
})
