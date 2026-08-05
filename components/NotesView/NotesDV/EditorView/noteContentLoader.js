const wait = delay => new Promise(resolve => setTimeout(resolve, delay))

export const loadNoteContentWithRetry = async (
    loadContent,
    { attempts = 3, retryDelay = 250, waitForRetry = wait } = {}
) => {
    let lastError

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const data = await loadContent()
            if (data !== null && data !== undefined) return data
            lastError = new Error('Note content download returned no data')
        } catch (error) {
            lastError = error
        }

        if (attempt < attempts - 1) {
            await waitForRetry(retryDelay * 2 ** attempt)
        }
    }

    throw lastError
}
