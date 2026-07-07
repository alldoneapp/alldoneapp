const {
    appendTaskPriorityLearningToInstructions,
    classifyComment,
    getTaskPriorityLearningContextMessage,
} = require('./taskPriorityLearning')

function createLearningDb(data) {
    const privateDoc = {
        get: jest.fn().mockResolvedValue({
            exists: !!data,
            data: () => data || {},
        }),
    }

    return {
        collection: jest.fn(collectionName => {
            if (collectionName !== 'users') throw new Error(`Unexpected collection ${collectionName}`)
            return {
                doc: jest.fn(() => ({
                    collection: jest.fn(privateCollection => {
                        if (privateCollection !== 'private') {
                            throw new Error(`Unexpected private collection ${privateCollection}`)
                        }
                        return {
                            doc: jest.fn(() => privateDoc),
                        }
                    }),
                })),
            }
        }),
    }
}

describe('taskPriorityLearning', () => {
    test('builds a skill overlay context message from learned rules', async () => {
        const db = createLearningDb({
            enabled: true,
            learnedRules: '- Prefer client deadlines before internal cleanup.',
        })

        const message = await getTaskPriorityLearningContextMessage({ db, userId: 'user-1' })

        expect(message).toContain('User-specific prioritization rules:')
        expect(message).toContain('Prefer client deadlines')
    })

    test('omits learned rules when learning is disabled', async () => {
        const db = createLearningDb({
            enabled: false,
            learnedRules: '- Prefer client deadlines before internal cleanup.',
        })

        await expect(getTaskPriorityLearningContextMessage({ db, userId: 'user-1' })).resolves.toBe('')
    })

    test('appends learned rules to loaded skill instructions', () => {
        expect(appendTaskPriorityLearningToInstructions('Base skill', 'User-specific prioritization rules:\n- X')).toBe(
            'Base skill\n\nUser-specific prioritization rules:\n- X'
        )
    })

    test('classifies priority-related comments and ignores unrelated comments', () => {
        expect(classifyComment('This is not a must do today.').classification).toBe('correction')
        expect(classifyComment('The draft has been uploaded.').classification).toBe('unrelated')
    })
})
