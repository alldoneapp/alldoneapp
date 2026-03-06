const {
    AUTO_FOLLOW_UP_TYPE,
    calculateFollowUpDueDate,
    getFollowUpTaskTitle,
    getPrimaryOpenManagedTask,
    isManagedContactStatusFollowUpTask,
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

    it('builds a readable follow-up title', () => {
        expect(getFollowUpTaskTitle({ displayName: 'Karsten Wysk' })).toBe('Follow up with Karsten Wysk')
        expect(getFollowUpTaskTitle({ displayName: '' })).toBe('Follow up with this contact')
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
})
