// A saved summary is readable independently of day-rate maintenance. One loader
// owns a project for the lifetime of the popup's user/date scope.
export const createNewDayProjectLoader = ({
    read,
    reconcile,
    isCurrent,
    onStatistics,
    onReadStart,
    onReadError,
    onDayRateState,
    onMaintenanceError,
    timeoutMs = 15000,
}) => {
    let disposed = false
    let hasStatistics = false
    let readVersion = 0
    let readTimer
    let maintenanceTimer
    let maintenanceRunning = false
    let maintenanceComplete = !reconcile
    let refreshNeeded = false
    let attempt = 0
    const controller = new AbortController()
    const active = () => !disposed && isCurrent()

    const readStatistics = (refresh = false) => {
        if (!active()) return
        const version = ++readVersion
        const readAttempt = ++attempt
        const startedAt = Date.now()
        clearTimeout(readTimer)
        onReadStart()
        const current = () => active() && version === readVersion
        const fail = error => {
            if (!current()) return
            clearTimeout(readTimer)
            const context = {
                stage: refresh ? 'statistics-refresh' : 'statistics-read',
                elapsedMs: Date.now() - startedAt,
                attempt: readAttempt,
            }
            if (refresh) onDayRateState('failed')
            if (hasStatistics) {
                refreshNeeded = true
                onDayRateState('failed')
                onMaintenanceError(error, context)
            } else onReadError(error, context)
        }
        readTimer = setTimeout(
            () => fail({ code: 'deadline-exceeded', message: 'Statistics loading timed out' }),
            timeoutMs
        )
        try {
            Promise.resolve(
                read(
                    statistics => {
                        if (!current()) return
                        clearTimeout(readTimer)
                        hasStatistics = true
                        onStatistics(statistics)
                        if (refresh && maintenanceComplete) {
                            refreshNeeded = false
                            onDayRateState('complete')
                        }
                    },
                    fail,
                    { refresh }
                )
            ).catch(fail)
        } catch (error) {
            fail(error)
        }
    }

    const startMaintenance = () => {
        if (!reconcile || maintenanceRunning || maintenanceComplete || !active()) return
        maintenanceRunning = true
        const startedAt = Date.now()
        onDayRateState('updating')
        const report = error =>
            onMaintenanceError(error, {
                stage: 'day-rate-reconciliation',
                elapsedMs: Date.now() - startedAt,
                attempt,
            })
        maintenanceTimer = setTimeout(() => {
            if (!active()) return
            onDayRateState('delayed')
            report({
                code: 'deadline-exceeded',
                message: 'Day-rate update timed out; saved statistics remain available',
            })
            // A pending SDK write cannot be cancelled. Keep ownership until it
            // settles so repeated retry taps cannot duplicate its corrections.
        }, timeoutMs)
        Promise.resolve()
            .then(() => {
                if (!active()) return
                return reconcile(controller.signal)
            })
            .then(
                () => {
                    maintenanceRunning = false
                    clearTimeout(maintenanceTimer)
                    if (!active()) return
                    maintenanceComplete = true
                    refreshNeeded = true
                    onDayRateState('updating')
                    // Invalidates the earlier read so a late pre-reconciliation response
                    // cannot overwrite the corrected figures.
                    readStatistics(true)
                },
                error => {
                    maintenanceRunning = false
                    clearTimeout(maintenanceTimer)
                    if (!active()) return
                    onDayRateState('failed')
                    report(error)
                }
            )
    }

    return {
        load: () => {
            if (!active()) return
            if (!hasStatistics || refreshNeeded) readStatistics(refreshNeeded)
            startMaintenance()
        },
        dispose: () => {
            disposed = true
            controller.abort()
            clearTimeout(readTimer)
            clearTimeout(maintenanceTimer)
        },
    }
}
