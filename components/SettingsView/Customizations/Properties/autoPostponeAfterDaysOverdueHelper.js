export const AUTO_POSTPONE_AFTER_DAYS_OVERDUE_DEFAULT = 3
export const AUTO_POSTPONE_AFTER_DAYS_OVERDUE_NEVER = 0

export const autoPostponeAfterDaysOverdueOptions = [
    { value: 1, shortcut: '1' },
    { value: 2, shortcut: '2' },
    { value: 3, shortcut: '3' },
    { value: 5, shortcut: '4' },
    { value: 7, shortcut: '5' },
    { value: 14, shortcut: '6' },
    { value: 30, shortcut: '7' },
    { value: AUTO_POSTPONE_AFTER_DAYS_OVERDUE_NEVER, shortcut: '8' },
]

const allowedValues = new Set(autoPostponeAfterDaysOverdueOptions.map(option => option.value))

export function normalizeAutoPostponeAfterDaysOverdue(value) {
    const parsedValue = Number(value)
    return allowedValues.has(parsedValue) ? parsedValue : AUTO_POSTPONE_AFTER_DAYS_OVERDUE_DEFAULT
}

export function formatAutoPostponeAfterDaysOverdue(value) {
    const normalizedValue = normalizeAutoPostponeAfterDaysOverdue(value)
    if (normalizedValue === AUTO_POSTPONE_AFTER_DAYS_OVERDUE_NEVER) {
        return { textKey: 'Never', interpolations: {} }
    }

    if (normalizedValue === 1) {
        return { textKey: '1 day', interpolations: {} }
    }

    return {
        textKey: 'Amount days',
        interpolations: { amount: normalizedValue },
    }
}
