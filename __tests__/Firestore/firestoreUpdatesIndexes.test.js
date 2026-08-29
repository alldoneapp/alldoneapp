/**
 * @jest-environment node
 */

const indexConfig = require('../../firestore.indexes.json')

const hasReaderDateIndex = collectionGroup =>
    indexConfig.indexes.some(index => {
        if (index.collectionGroup !== collectionGroup || index.queryScope !== 'COLLECTION') return false
        return (
            index.fields?.length === 2 &&
            index.fields[0]?.fieldPath === 'readerIds' &&
            index.fields[0]?.arrayConfig === 'CONTAINS' &&
            index.fields[1]?.fieldPath === 'lastChangeDate' &&
            index.fields[1]?.order === 'DESCENDING'
        )
    })

describe('Updates Firestore index contract', () => {
    it.each(['all', 'followed'])('declares the readerIds activity index for %s feeds', collectionGroup => {
        expect(hasReaderDateIndex(collectionGroup)).toBe(true)
    })
})
