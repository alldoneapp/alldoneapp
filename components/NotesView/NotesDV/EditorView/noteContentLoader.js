const wait = delay => new Promise(resolve => setTimeout(resolve, delay))

const withTimeout = (promise, timeoutMs) => {
    if (!timeoutMs) return promise
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Note content download timed out after ${timeoutMs}ms`)),
            timeoutMs
        )
        promise.then(
            value => {
                clearTimeout(timer)
                resolve(value)
            },
            error => {
                clearTimeout(timer)
                reject(error)
            }
        )
    })
}

export const loadNoteContentWithRetry = async (
    loadContent,
    { attempts = 3, retryDelay = 250, waitForRetry = wait, attemptTimeoutMs } = {}
) => {
    let lastError

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            // The Storage SDK retries network failures internally far longer than
            // any spinner should live; the per-attempt timeout keeps the caller's
            // fallback paths reachable even when the SDK is still retrying.
            const data = await withTimeout(loadContent(), attemptTimeoutMs)
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
