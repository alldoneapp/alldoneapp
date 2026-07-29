import { convertCurrency, formatCurrency } from '../../../utils/CurrencyConverter'
import { getSafeStatisticNumber } from '../../../utils/StatisticDataHelper'

export const getEndDayMoneyEarnedSummary = (projects, statisticsByProject, userId, defaultCurrency = 'EUR') => {
    const moneyEarned = (projects || []).reduce((total, project) => {
        const currency = project?.hourlyRatesData?.currency
        const hourlyRate = getSafeStatisticNumber(project?.hourlyRatesData?.hourlyRates?.[userId])
        const doneTime = getSafeStatisticNumber(statisticsByProject?.[project?.id]?.doneTime)

        if (!currency || hourlyRate <= 0 || doneTime <= 0) return total

        const projectEarnings = (doneTime / 60) * hourlyRate
        return total + convertCurrency(projectEarnings, currency, defaultCurrency)
    }, 0)

    if (moneyEarned <= 0) return null

    return {
        amount: moneyEarned,
        currency: defaultCurrency,
        formattedValue: formatCurrency(moneyEarned, defaultCurrency),
    }
}
