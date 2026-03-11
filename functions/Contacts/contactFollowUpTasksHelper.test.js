const {
    AUTO_FOLLOW_UP_TYPE,
    calculateFollowUpDueDate,
    classifyManagedOpenTasks,
    getEndOfTodayTimestamp,
    getContactMentionText,
    getFollowUpTaskTitle,
    getManagedTaskBuckets,
    getPrimaryOpenManagedTask,
    isManagedContactStatusFollowUpTask,
    normalizeTimezoneOffset,
    normalizeFollowUpDays,
    sortTasksDeterministically,
} = require('./contactFollowUpTasksHelper')

describe('contactFollowUpTasksHelper', () => {
    describe('normalizeFollowUpDays', () => {
        it('returns a positive integer when valid', () => {
            expect(normalizeFollowUpDays(3)).toBe(3)
            expect(normalizeFollowUpDays('5')).toBe(5)
        })

        it('returns null for invalid values', () => {
            expect(normalizeFollowUpDays(null)).toBeNull()
            expect(normalizeFollowUpDays(0)).toBeNull()
            expect(normalizeFollowUpDays(-1)).toBeNull()
            expect(normalizeFollowUpDays(1.2)).toBeNull()
            expect(normalizeFollowUpDays('abc')).toBeNull()
        })
    })

    it('calculates the follow-up due date from last edition date', () => {
        expect(calculateFollowUpDueDate(1000, 3)).toBe(1000 + 3 * 24 * 60 * 60 * 1000)
    })

    it('normalizes timezone offsets from numbers and strings', () => {
        expect(normalizeTimezoneOffset(2)).toBe(120)
        expect(normalizeTimezoneOffset(90)).toBe(90)
        expect(normalizeTimezoneOffset('+02:30')).toBe(150)
        expect(normalizeTimezoneOffset('Europe/Berlin')).toBeGreaterThanOrEqual(60)
    })

    it('computes end of today in the provided timezone', () => {
        const now = Date.UTC(2026, 2, 11, 10, 0, 0)
        expect(getEndOfTodayTimestamp(120, now)).toBe(Date.UTC(2026, 2, 11, 21, 59, 59, 999))
        expect(getEndOfTodayTimestamp(-300, now)).toBe(Date.UTC(2026, 2, 12, 4, 59, 59, 999))
    })

    it('builds a readable follow-up title', () => {
        expect(getFollowUpTaskTitle({ displayName: 'Karsten Wysk' })).toBe('Follow up with Karsten Wysk')
        expect(getFollowUpTaskTitle({ displayName: '' })).toBe('Follow up with this contact')
    })

    it('builds a contact mention tag using the app mention format', () => {
        expect(getContactMentionText({ uid: 'c1', displayName: 'Karsten Wysk' }, 'M2mVOSjAVPPKweL')).toBe(
            '@KarstenM2mVOSjAVPPKweLWysk#c1'
        )
        expect(getContactMentionText({ uid: '', displayName: 'Karsten Wysk' }, 'M2mVOSjAVPPKweL')).toBe('')
    })

    it('identifies managed contact-status follow-up tasks', () => {
        expect(
            isManagedContactStatusFollowUpTask({
                autoFollowUpManaged: true,
                autoFollowUpType: AUTO_FOLLOW_UP_TYPE,
                autoFollowUpContactId: 'contact-1',
            })
        ).toBe(true)

        expect(
            isManagedContactStatusFollowUpTask({
                autoFollowUpManaged: true,
                autoFollowUpType: 'other-type',
                autoFollowUpContactId: 'contact-1',
            })
        ).toBe(false)
    })

    it('sorts tasks deterministically and picks the oldest open task', () => {
        const tasks = [
            { id: 'b', created: 2000 },
            { id: 'a', created: 1000 },
            { id: 'c', created: 1000 },
        ]

        expect(sortTasksDeterministically(tasks).map(task => task.id)).toEqual(['a', 'c', 'b'])
        expect(getPrimaryOpenManagedTask(tasks).id).toBe('a')
    })

    it('classifies open managed tasks into current and future buckets', () => {
        const tasks = [
            { id: 'future-2', created: 4000, dueDate: 5000 },
            { id: 'current-2', created: 2000, dueDate: 3000 },
            { id: 'current-1', created: 1000, dueDate: 2500 },
            { id: 'future-1', created: 3000, dueDate: 4500 },
        ]

        expect(classifyManagedOpenTasks(tasks, 4000)).toEqual({
            currentTask: { id: 'current-1', created: 1000, dueDate: 2500 },
            futureTask: { id: 'future-1', created: 3000, dueDate: 4500 },
            duplicateCurrentTasks: [{ id: 'current-2', created: 2000, dueDate: 3000 }],
            duplicateFutureTasks: [{ id: 'future-2', created: 4000, dueDate: 5000 }],
        })
    })

    it('builds managed task buckets using timezone-sensitive end of today', () => {
        const now = Date.UTC(2026, 2, 11, 10, 0, 0)
        const dueLaterTodayUtc = Date.UTC(2026, 2, 11, 20, 0, 0)
        const dueTomorrowUtc = Date.UTC(2026, 2, 12, 8, 0, 0)

        expect(
            getManagedTaskBuckets(
                [
                    { id: 'later-today', created: 1000, dueDate: dueLaterTodayUtc },
                    { id: 'tomorrow', created: 2000, dueDate: dueTomorrowUtc },
                ],
                120,
                now
            )
        ).toMatchObject({
            currentTask: { id: 'later-today' },
            futureTask: { id: 'tomorrow' },
        })
    })
})
