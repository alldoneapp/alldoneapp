'use strict'

const { awardUserXp, getLevelForXp, getUtcStatisticsKeys, validateXpAward } = require('./userXpService')

const increment = value => ({ increment: value })

function createDb({ project, user }) {
    const writes = []
    const refs = new Map()
    const db = {
        doc: path => {
            if (!refs.has(path)) refs.set(path, { path })
            return refs.get(path)
        },
        runTransaction: callback =>
            callback({
                get: async ref => {
                    const data = ref.path.startsWith('projects/') ? project : user
                    return { exists: !!data, data: () => data }
                },
                update: (ref, data) => writes.push({ operation: 'update', path: ref.path, data }),
                set: (ref, data, options) => writes.push({ operation: 'set', path: ref.path, data, options }),
            }),
    }
    return { db, writes }
}

describe('user XP service', () => {
    it('calculates stable level and UTC statistics keys', () => {
        expect(getLevelForXp(1, 41999)).toBe(1)
        expect(getLevelForXp(1, 42000)).toBe(2)
        expect(getLevelForXp(3, 100)).toBe(3)
        expect(getUtcStatisticsKeys(Date.UTC(2026, 7, 28, 23, 59))).toEqual({
            documentId: '28082026',
            day: 20260828,
        })
    })

    it('rejects unbounded or malformed client awards', () => {
        expect(() =>
            validateXpAward({ projectId: 'project-1', userId: 'user-1', xpEarned: 10001, increaseProjectQuota: true })
        ).toThrow('between 1 and 10000')
    })

    it('updates member XP, statistics and project quota in one transaction', async () => {
        const { db, writes } = createDb({
            project: { userIds: ['user-1'] },
            user: { xp: 41900, level: 1 },
        })

        await expect(
            awardUserXp({
                db,
                FieldValue: { increment },
                projectId: 'project-1',
                userId: 'user-1',
                xpEarned: 200,
                increaseProjectQuota: true,
                now: Date.UTC(2026, 7, 28),
            })
        ).resolves.toEqual({ totalXp: 42100, level: 2, earnedSkillPoints: 5 })

        expect(writes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    operation: 'update',
                    path: 'users/user-1',
                    data: expect.objectContaining({ xp: 42100, monthlyXp: increment(200), skillPoints: increment(5) }),
                }),
                expect.objectContaining({ path: 'statistics/project-1/user-1/28082026' }),
                expect.objectContaining({ path: 'projects/project-1', data: { monthlyXp: increment(200) } }),
            ])
        )
    })

    it('rejects an award to somebody outside the authoritative project membership', async () => {
        const { db } = createDb({ project: { userIds: ['member-1'] }, user: { xp: 0, level: 1 } })

        await expect(
            awardUserXp({
                db,
                FieldValue: { increment },
                projectId: 'project-1',
                userId: 'outsider',
                xpEarned: 1,
                increaseProjectQuota: false,
            })
        ).rejects.toThrow('not a project member')
    })
})
