// One pending save per account. A rejected bounded request releases this slot;
// retrying never queues behind a permanently unresolved SDK transaction.
export const createNewDayAcknowledgementRetry = ({ persist, isPending, isActive, onError }) => {
    let operation
    let timer
    let stopped = false
    let failures = 0
    const active = () => !stopped && isActive()
    const retry = () => {
        if (operation) return operation
        clearTimeout(timer)
        if (!active() || !isPending()) return Promise.resolve()
        let attempt
        try {
            attempt = persist()
        } catch (error) {
            attempt = Promise.reject(error)
        }
        operation = Promise.resolve(attempt)
            .then(() => {
                failures = 0
            })
            .catch(error => {
                failures++
                if (!stopped) onError(error)
                throw error
            })
            .finally(() => {
                operation = null
                if (active() && isPending()) {
                    timer = setTimeout(
                        () => {
                            void retry().catch(() => {})
                        },
                        Math.min(5000 * 2 ** Math.min(failures, 4), 60000)
                    )
                }
            })
        return operation
    }
    return {
        retry,
        dispose: () => {
            stopped = true
            clearTimeout(timer)
        },
    }
}
