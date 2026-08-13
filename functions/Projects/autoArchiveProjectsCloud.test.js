'use strict'

const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn(() => Promise.resolve())
const mockSetProjectContext = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { arrayUnion: jest.fn(value => ({ arrayUnion: value })) },
}))
jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        update: mockBatchUpdate,
        commit: mockBatchCommit,
        setProjectContext: mockSetProjectContext,
        feedObjects: {},
    })),
}))
jest.mock('../Feeds/projectsFeeds', () => ({
    createProjectAutoArchivedFeed: jest.fn(() => Promise.resolve()),
}))
jest.mock('../GlobalState/globalState', () => ({
    loadFeedsGlobalState: jest.fn(),
}))

const {
    AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT,
    getEligibleProjectIds,
    getTimestampMillis,
    normalizeAutoArchiveProjectsAfterDays,
    processUserAutoArchive,
    shouldAutoArchiveProject,
} = require('./autoArchiveProjectsCloud')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createProjectAutoArchivedFeed } = require('../Feeds/projectsFeeds')

describe('autoArchiveProjectsCloud', () => {
    const NOW = Date.UTC(2026, 7, 13, 10, 0, 0)
    const DAY_MS = 24 * 60 * 60 * 1000

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('uses 30 days by default and supports disabling the automation', () => {
        expect(normalizeAutoArchiveProjectsAfterDays(undefined)).toBe(AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT)
        expect(normalizeAutoArchiveProjectsAfterDays(0)).toBe(0)
        expect(normalizeAutoArchiveProjectsAfterDays(45)).toBe(AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT)
    })

    test('permanently excludes the current default project and inactive project types', () => {
        expect(
            getEligibleProjectIds({
                projectIds: ['default', 'active', 'archived', 'template', 'guide'],
                defaultProjectId: 'default',
                archivedProjectIds: ['archived'],
                templateProjectIds: ['template'],
                guideProjectIds: ['guide'],
            })
        ).toEqual(['active'])
    })

    test('archives only after the full inactivity threshold', () => {
        expect(shouldAutoArchiveProject({ lastActionDate: NOW - 30 * DAY_MS }, 30, NOW)).toBe(true)
        expect(shouldAutoArchiveProject({ lastActionDate: NOW - 30 * DAY_MS + 1 }, 30, NOW)).toBe(false)
        expect(shouldAutoArchiveProject({ lastActionDate: NOW - 365 * DAY_MS, isTemplate: true }, 30, NOW)).toBe(false)
        expect(shouldAutoArchiveProject({ created: NOW - 31 * DAY_MS }, 30, NOW)).toBe(true)
        expect(shouldAutoArchiveProject({}, 30, NOW)).toBe(false)
    })

    test('supports Firestore Timestamp activity values', () => {
        expect(getTimestampMillis({ toMillis: () => NOW })).toBe(NOW)
    })

    test('re-checks the default project immediately before archiving', async () => {
        const initialUser = {
            projectIds: ['old-default', 'new-default'],
            defaultProjectId: 'old-default',
            autoArchiveProjectsAfterDays: 30,
        }
        const freshUser = { ...initialUser, defaultProjectId: 'new-default' }
        const db = {
            doc: jest.fn(path => ({
                get: jest.fn(() =>
                    Promise.resolve(
                        path.startsWith('users/')
                            ? { exists: true, data: () => freshUser }
                            : { exists: true, data: () => ({ lastActionDate: NOW - 60 * DAY_MS }) }
                    )
                ),
            })),
        }

        await expect(processUserAutoArchive('user-1', initialUser, NOW, db)).resolves.toMatchObject({
            archivedCount: 0,
        })
        expect(BatchWrapper).not.toHaveBeenCalled()
        expect(createProjectAutoArchivedFeed).not.toHaveBeenCalled()
    })

    test('archives an inactive non-default project and creates its feed in the same batch', async () => {
        const userData = {
            projectIds: ['default', 'inactive'],
            defaultProjectId: 'default',
            autoArchiveProjectsAfterDays: 30,
            displayName: 'Ada Lovelace',
        }
        const projectData = { name: 'Inactive', lastActionDate: NOW - 60 * DAY_MS, userIds: ['user-1'] }
        const db = {
            doc: jest.fn(path => ({
                get: jest.fn(() =>
                    Promise.resolve(
                        path.startsWith('users/')
                            ? { exists: true, data: () => userData }
                            : { exists: true, data: () => projectData }
                    )
                ),
            })),
        }

        await expect(processUserAutoArchive('user-1', userData, NOW, db)).resolves.toMatchObject({
            archivedCount: 1,
        })
        expect(mockBatchUpdate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ archivedProjectIds: { arrayUnion: 'inactive' } })
        )
        expect(createProjectAutoArchivedFeed).toHaveBeenCalledWith(
            'inactive',
            expect.objectContaining({ id: 'inactive', name: 'Inactive' }),
            30,
            expect.anything(),
            expect.objectContaining({ uid: 'user-1' })
        )
        expect(mockBatchCommit).toHaveBeenCalledTimes(1)
    })
})
