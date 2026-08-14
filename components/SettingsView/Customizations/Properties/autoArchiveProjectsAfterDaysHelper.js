export const AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT = 30
export const AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_NEVER = 0

export const autoArchiveProjectsAfterDaysOptions = [
    { value: 30, shortcut: '1' },
    { value: 60, shortcut: '2' },
    { value: 90, shortcut: '3' },
    { value: 180, shortcut: '4' },
    { value: 365, shortcut: '5' },
    { value: AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_NEVER, shortcut: '6' },
]

const allowedValues = new Set(autoArchiveProjectsAfterDaysOptions.map(option => option.value))

export function normalizeAutoArchiveProjectsAfterDays(value) {
    const parsedValue = Number(value)
    return allowedValues.has(parsedValue) ? parsedValue : AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT
}

export function formatAutoArchiveProjectsAfterDays(value) {
    const normalizedValue = normalizeAutoArchiveProjectsAfterDays(value)
    return normalizedValue === AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_NEVER
        ? { textKey: 'Never', interpolations: {} }
        : { textKey: 'Amount days', interpolations: { amount: normalizedValue } }
}
