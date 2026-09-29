const mockDocs = new Map()
const mockDeductGold = jest.fn()

const mockRef = path => ({
    path,
    get: jest.fn(async () => {
        const data = mockDocs.get(path)
        return { exists: data !== undefined, data: () => data }
    }),
    set: jest.fn(async (update, options) => {
        const current = options && options.merge ? mockDocs.get(path) || {} : {}
        const next = { ...current }
        Object.entries(update).forEach(([key, value]) => {
            if (value && value.__arrayUnion) {
                const list = Array.isArray(current[key]) ? current[key] : []
                next[key] = [...list, ...value.__arrayUnion.filter(item => !list.includes(item))]
            } else next[key] = value
        })
        mockDocs.set(path, next)
    }),
})

jest.mock('firebase-admin', () => {
    const refs = new Map()
    const doc = path => {
        if (!refs.has(path)) refs.set(path, mockRef(path))
        return refs.get(path)
    }
    return {
        firestore: () => ({
            doc,
            runTransaction: async fn =>
                fn({
                    get: ref => ref.get(),
                    set: (ref, update, options) => ref.set(update, options),
                }),
        }),
    }
})
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { arrayUnion: (...items) => ({ __arrayUnion: items }) },
}))
jest.mock('../Gold/goldHelper', () => ({ deductGold: (...args) => mockDeductGold(...args) }))

const {
    getRageModeProfile,
    MAX_SCORE,
    normalizeProfile,
    purchaseRageModeItem,
    submitRageModeScore,
} = require('./rageModeProfile')
const { RAGE_WEAPON_PRICES } = require('./rageWeaponsCatalog')

describe('rage mode profile', () => {
    beforeEach(() => {
        mockDocs.clear()
        mockDeductGold.mockReset()
    })

    it('gives everyone the blaster and no highscore to start with', async () => {
        expect(await getRageModeProfile({ userId: 'u1' })).toEqual({ owned: ['blaster'], highscore: 0, games: 0 })
    })

    it('ignores weapons that are not in the catalog and duplicates', () => {
        expect(normalizeProfile({ owned: ['rocket', 'bazooka', 'rocket', 'blaster'] }).owned).toEqual([
            'blaster',
            'rocket',
        ])
    })

    describe('buying a weapon', () => {
        it('charges its catalog price once, with an idempotency key per weapon, and grants it', async () => {
            mockDeductGold.mockResolvedValue({ success: true, newBalance: 750 })
            const result = await purchaseRageModeItem({ userId: 'u1', itemId: 'rocket' })
            expect(mockDeductGold).toHaveBeenCalledWith('u1', RAGE_WEAPON_PRICES.rocket, {
                source: 'rage_mode_item',
                note: 'rocket',
                idempotencyKey: 'rage_mode_item:rocket',
            })
            expect(result).toEqual(expect.objectContaining({ ok: true, newBalance: 750 }))
            expect(result.owned).toEqual(['blaster', 'rocket'])
            expect((await getRageModeProfile({ userId: 'u1' })).owned).toEqual(['blaster', 'rocket'])
        })

        it('never charges for a weapon that is already owned', async () => {
            mockDocs.set('rageModeProfiles/u1', { owned: ['laser'] })
            const result = await purchaseRageModeItem({ userId: 'u1', itemId: 'laser' })
            expect(result).toEqual(expect.objectContaining({ ok: true, alreadyOwned: true }))
            expect(mockDeductGold).not.toHaveBeenCalled()
        })

        it('grants nothing when the user cannot afford it', async () => {
            mockDeductGold.mockResolvedValue({ success: false, message: 'Insufficient gold', currentGold: 40 })
            const result = await purchaseRageModeItem({ userId: 'u1', itemId: 'snap' })
            expect(result).toEqual({ ok: false, reason: 'insufficient_gold', currentGold: 40 })
            expect(mockDocs.get('rageModeProfiles/u1')).toBeUndefined()
        })

        it('refuses unknown and free items without charging', async () => {
            expect(await purchaseRageModeItem({ userId: 'u1', itemId: 'bazooka' })).toEqual({
                ok: false,
                reason: 'unknown_item',
            })
            expect(await purchaseRageModeItem({ userId: 'u1', itemId: { $gt: '' } })).toEqual({
                ok: false,
                reason: 'unknown_item',
            })
            expect(mockDeductGold).not.toHaveBeenCalled()
        })

        it('finishes a purchase whose charge already went through (retry after a failed write)', async () => {
            mockDeductGold.mockResolvedValue({ success: true, alreadyProcessed: true, newBalance: 900 })
            const result = await purchaseRageModeItem({ userId: 'u1', itemId: 'shotgun' })
            expect(result).toEqual(expect.objectContaining({ ok: true, alreadyCharged: true }))
            expect((await getRageModeProfile({ userId: 'u1' })).owned).toContain('shotgun')
        })
    })

    describe('scores', () => {
        it('keeps the best score and counts games', async () => {
            expect(await submitRageModeScore({ userId: 'u1', score: 120 })).toEqual(
                expect.objectContaining({ ok: true, isNew: true, highscore: 120 })
            )
            expect(await submitRageModeScore({ userId: 'u1', score: 80 })).toEqual(
                expect.objectContaining({ ok: true, isNew: false, highscore: 120 })
            )
            expect(await submitRageModeScore({ userId: 'u1', score: 300.7 })).toEqual(
                expect.objectContaining({ isNew: true, highscore: 300, previous: 120 })
            )
            expect(await getRageModeProfile({ userId: 'u1' })).toEqual(
                expect.objectContaining({ highscore: 300, games: 3 })
            )
        })

        it.each([[-1], [MAX_SCORE + 1], ['lots'], [NaN], [null]])('rejects an invalid score %p', async score => {
            expect(await submitRageModeScore({ userId: 'u1', score })).toEqual({ ok: false, reason: 'invalid_score' })
        })
    })
})
