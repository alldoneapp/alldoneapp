/**
 * @jest-environment node
 */

const indexConfig = require('../../firestore.indexes.json')

const hasChatIndex = expectedFields =>
    indexConfig.indexes.some(index => {
        if (index.collectionGroup !== 'chats' || index.queryScope !== 'COLLECTION') return false
        if (index.fields?.length !== expectedFields.length) return false

        return expectedFields.every((expected, indexPosition) => {
            const actual = index.fields[indexPosition]
            return (
                actual?.fieldPath === expected.fieldPath &&
                actual?.arrayConfig === expected.arrayConfig &&
                actual?.order === expected.order
            )
        })
    })

describe('Chats Firestore index contract', () => {
    it.each(['readerIds', 'followedReaderIds'])('declares list and sticky indexes for %s', projectionField => {
        const projection = { fieldPath: projectionField, arrayConfig: 'CONTAINS' }
        const stickyDays = { fieldPath: 'stickyData.days', order: 'ASCENDING' }

        expect(hasChatIndex([projection, stickyDays])).toBe(true)
        expect(hasChatIndex([projection, stickyDays, { fieldPath: 'lastEditionDate', order: 'DESCENDING' }])).toBe(true)
    })
})
