import moment from 'moment'
import { translate } from './TranslationService'

// Translate the entire phrase: German places "vor" before the number, while
// English and Spanish place "ago" / "atrás" after it.
const units = [
    {
        unit: 'seconds',
        limit: 60,
        singular: '1 second ago',
        plural: 'Amount seconds ago',
        short: 'Amount sec ago',
        compact: 'Amount s ago',
    },
    {
        unit: 'minutes',
        limit: 60,
        singular: '1 minute ago',
        plural: 'Amount minutes ago',
        short: 'Amount min ago',
        compact: 'Amount m ago',
    },
    { unit: 'hours', limit: 24, singular: '1 hour ago', plural: 'Amount hours ago', compact: 'Amount h ago' },
    { unit: 'days', singular: '1 day ago', plural: 'Amount days ago' },
]

export const formatLastEditDate = (
    serverDate,
    lastEditDate,
    { compact = false, tablet = false, dateFormat = 'DD.MM.YYYY', relativeDays = false } = {}
) => {
    const today = moment(serverDate)
    const lastEdit = moment(lastEditDate)

    for (const { unit, limit, singular, plural, short, compact: compactKey } of units) {
        if (unit === 'days' && !relativeDays) return lastEdit.format(dateFormat)
        const amount = Math.max(0, today.diff(lastEdit, unit))
        if (!limit || amount < limit) {
            const key = compact && compactKey ? compactKey : tablet && short ? short : amount === 1 ? singular : plural
            return translate(key, { amount })
        }
    }
}
