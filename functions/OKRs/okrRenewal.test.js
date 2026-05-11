jest.mock(
    'firebase-admin',
    () => ({
        firestore: jest.fn(),
    }),
    { virtual: true }
)

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    getFirstName: name => String(name || '').split(' ')[0],
}))

jest.mock('../Assistant/assistantHelper', () => ({
    addBaseInstructions: jest.fn(),
    getAssistantForChat: jest.fn(),
    getCommonData: jest.fn(),
    interactWithChatStream: jest.fn(),
    storeBotAnswerStream: jest.fn(),
}))

const admin = require('firebase-admin')
const { renewOKRDoc } = require('./okrRenewal')

function createDoc(id, data, path, db) {
    return {
        id,
        exists: !!data,
        ref: {
            path,
            parent: {
                parent: {
                    id: 'project-1',
                },
            },
        },
        data: () => data,
        _db: db,
    }
}

function createFakeFirestore(initialOldData) {
    const writes = {
        oldData: { ...initialOldData },
        docs: {},
        updates: [],
        sets: [],
    }

    const db = {
        doc(path) {
            return { path }
        },
        async runTransaction(callback) {
            const transaction = {
                async get(ref) {
                    if (ref.path === 'okrs/project-1/projectOkrs/okr-1') {
                        return createDoc('okr-1', writes.oldData, ref.path, db)
                    }
                    const id = ref.path.split('/').pop()
                    return createDoc(id, writes.docs[ref.path] || null, ref.path, db)
                },
                update(ref, patch) {
                    writes.updates.push({ path: ref.path, patch })
                    if (ref.path === 'okrs/project-1/projectOkrs/okr-1') {
                        writes.oldData = {
                            ...writes.oldData,
                            ...patch,
                        }
                    }
                },
                set(ref, data) {
                    writes.sets.push({ path: ref.path, data })
                    writes.docs[ref.path] = data
                },
            }
            return callback(transaction)
        },
        writes,
    }

    return db
}

describe('OKR renewal', () => {
    test('closes the ended OKR and creates the next period only once', async () => {
        const originalNow = Date.now
        Date.now = jest.fn(() => Date.UTC(2026, 1, 2, 12))

        const db = createFakeFirestore({
            objectType: 'okr',
            ownerId: 'user-1',
            label: 'Reach revenue',
            currentValue: 8,
            targetValue: 10,
            unit: 'k',
            cadence: 'weekly',
            periodStart: Date.UTC(2026, 0, 26),
            periodEnd: Date.UTC(2026, 1, 1, 23, 59, 59, 999),
            status: 'active',
            renewalProcessedAt: null,
        })
        admin.firestore.mockReturnValue(db)

        const okrDoc = createDoc('okr-1', db.writes.oldData, 'okrs/project-1/projectOkrs/okr-1', db)
        const renewed = await renewOKRDoc(okrDoc, { timezone: 'UTC' })
        const renewedAgain = await renewOKRDoc(okrDoc, { timezone: 'UTC' })

        expect(renewed).toMatchObject({
            id: 'okr-1',
            ownerId: 'user-1',
            projectId: 'project-1',
            status: 'active',
        })
        expect(renewedAgain).toBeNull()
        expect(db.writes.updates).toHaveLength(1)
        expect(db.writes.updates[0].patch).toMatchObject({
            status: 'closed',
            lastEditorId: 'system',
        })
        expect(db.writes.updates[0].patch.renewalProcessedAt).toBe(Date.UTC(2026, 1, 2, 12))
        expect(db.writes.sets).toHaveLength(1)
        expect(db.writes.sets[0].data).toMatchObject({
            currentValue: 0,
            status: 'active',
            previousOkrId: 'okr-1',
            ownerId: 'user-1',
            label: 'Reach revenue',
            targetValue: 10,
            renewalProcessedAt: null,
        })

        Date.now = originalNow
    })
})
