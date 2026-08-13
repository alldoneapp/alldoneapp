import {
    AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT,
    AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_NEVER,
    formatAutoArchiveProjectsAfterDays,
    normalizeAutoArchiveProjectsAfterDays,
} from './autoArchiveProjectsAfterDaysHelper'

describe('autoArchiveProjectsAfterDaysHelper', () => {
    test('defaults missing and unsupported values to 30 days', () => {
        expect(normalizeAutoArchiveProjectsAfterDays(undefined)).toBe(AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT)
        expect(normalizeAutoArchiveProjectsAfterDays(45)).toBe(AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT)
    })

    test('keeps supported values including Never', () => {
        expect(normalizeAutoArchiveProjectsAfterDays(90)).toBe(90)
        expect(normalizeAutoArchiveProjectsAfterDays(AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_NEVER)).toBe(0)
    })

    test('formats the selected interval', () => {
        expect(formatAutoArchiveProjectsAfterDays(60)).toEqual({
            textKey: 'Amount days',
            interpolations: { amount: 60 },
        })
        expect(formatAutoArchiveProjectsAfterDays(0)).toEqual({ textKey: 'Never', interpolations: {} })
    })
})
