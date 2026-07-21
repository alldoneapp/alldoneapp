import getAllProjectsOpenTasksAmount from './getAllProjectsOpenTasksAmount'

describe('getAllProjectsOpenTasksAmount', () => {
    const userId = 'user-1'

    it('adds the current user open tasks across projects', () => {
        const sidebarNumbers = {
            loading: false,
            'project-1': { [userId]: 3, 'user-2': 9 },
            'project-2': { [userId]: 4 },
        }

        expect(getAllProjectsOpenTasksAmount(sidebarNumbers, userId)).toBe(7)
    })

    it('excludes archived and template projects', () => {
        const sidebarNumbers = {
            active: { [userId]: 2 },
            archived: { [userId]: 5 },
            template: { [userId]: 7 },
        }

        expect(getAllProjectsOpenTasksAmount(sidebarNumbers, userId, ['archived'], ['template'])).toBe(2)
    })

    it.each([
        [undefined, userId],
        [{ loading: true }, userId],
        [{ project: { [userId]: 0 } }, userId],
        [{ project: { [userId]: 3 } }, undefined],
    ])('returns zero for empty, loading, or unavailable data', (sidebarNumbers, selectedUserId) => {
        expect(getAllProjectsOpenTasksAmount(sidebarNumbers, selectedUserId)).toBe(0)
    })
})
