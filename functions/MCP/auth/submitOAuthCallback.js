// Embedded in the login page with toString(), so this function must be self-contained.
async function submitOAuthCallback(callbackUrl, payload, onRetry = () => {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        try {
            const response = await fetch(callbackUrl, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                cache: 'no-store',
                signal: controller.signal,
            })
            if ([502, 503, 504].includes(response.status)) {
                throw new TypeError('Connection temporarily unavailable')
            }
            const data = await response.json()
            if (!response.ok && data.success !== false) {
                throw new Error('Authentication failed. Please start a new connection.')
            }
            return data
        } catch (error) {
            const retryable = error.name === 'TypeError' || error.name === 'AbortError'
            if (!retryable) throw error
            if (attempt === 2) {
                throw new Error('Connection interrupted. Click Retry connection to continue.')
            }
            onRetry()
        } finally {
            clearTimeout(timeout)
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
    }
}

module.exports = { submitOAuthCallback }
