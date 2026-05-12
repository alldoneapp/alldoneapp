import { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import Backend from '../../../utils/BackendBridge'
import { ESTIMATION_TYPE_TIME } from '../../../utils/EstimationHelper'
import { calculateRevenueOkrCurrentValue, normalizeOkrNumber } from './okrHelper'

export default function useOkrRevenueValue({ projectId, ownerId, periodStart, periodEnd }) {
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const [doneTimeMinutes, setDoneTimeMinutes] = useState(0)

    const hourlyRate = normalizeOkrNumber(project?.hourlyRatesData?.hourlyRates?.[ownerId])
    const currency = project?.hourlyRatesData?.currency || 'EUR'
    const estimationType = project?.estimationType || ESTIMATION_TYPE_TIME
    const normalizedPeriodStart = normalizeOkrNumber(periodStart, NaN)
    const normalizedPeriodEnd = normalizeOkrNumber(periodEnd, NaN)

    useEffect(() => {
        if (
            !projectId ||
            !ownerId ||
            !Number.isFinite(normalizedPeriodStart) ||
            !Number.isFinite(normalizedPeriodEnd)
        ) {
            setDoneTimeMinutes(0)
            return undefined
        }

        const watcherKey = v4()
        Backend.watchUserStatistics(
            projectId,
            estimationType,
            ownerId,
            normalizedPeriodStart,
            normalizedPeriodEnd,
            watcherKey,
            (callbackProjectId, statistics) => {
                if (callbackProjectId === projectId) setDoneTimeMinutes(normalizeOkrNumber(statistics?.doneTime))
            }
        )

        return () => Backend.unwatch(watcherKey)
    }, [projectId, ownerId, estimationType, normalizedPeriodStart, normalizedPeriodEnd])

    return useMemo(
        () => ({
            currentValue: calculateRevenueOkrCurrentValue(doneTimeMinutes, hourlyRate),
            doneTimeMinutes,
            hourlyRate,
            currency,
            missingHourlyRate: hourlyRate <= 0,
        }),
        [doneTimeMinutes, hourlyRate, currency]
    )
}
