#!/usr/bin/env node

/**
 * Merge existing Firestore indexes with new ones
 * Usage: node merge-indexes.js existing-indexes.json
 */

const fs = require('fs')
const path = require('path')

// Check command line arguments
if (process.argv.length < 3) {
    console.log('Usage: node merge-indexes.js <existing-indexes-file>')
    console.log('Example: node merge-indexes.js firestore-backups/indexes-backup-20231120-143022.json')
    process.exit(1)
}

const existingFile = process.argv[2]
const newFile = 'firestore.indexes.json'
const outputFile = 'firestore.indexes.merged.json'

try {
    // Read files
    const existing = JSON.parse(fs.readFileSync(existingFile, 'utf8'))
    const newIndexes = JSON.parse(fs.readFileSync(newFile, 'utf8'))

    // Create a map of existing indexes for easy lookup
    const indexMap = new Map()

    // Add existing indexes to map
    if (existing.indexes) {
        existing.indexes.forEach(index => {
            const key = `${index.collectionGroup}-${JSON.stringify(index.fields)}`
            indexMap.set(key, index)
        })
    }

    // Add new indexes (will override if duplicate)
    let addedCount = 0
    let updatedCount = 0

    newIndexes.indexes.forEach(index => {
        const key = `${index.collectionGroup}-${JSON.stringify(index.fields)}`
        if (indexMap.has(key)) {
            updatedCount++
        } else {
            addedCount++
        }
        indexMap.set(key, index)
    })

    // Convert back to array
    const mergedIndexes = {
        indexes: Array.from(indexMap.values()),
        fieldOverrides: existing.fieldOverrides || [],
    }

    // Write merged file
    fs.writeFileSync(outputFile, JSON.stringify(mergedIndexes, null, 2))

    console.log('✅ Indexes merged successfully!')
    console.log(`📊 Summary:`)
    console.log(`   • Existing indexes: ${existing.indexes ? existing.indexes.length : 0}`)
    console.log(`   • New indexes to add: ${addedCount}`)
    console.log(`   • Indexes to update: ${updatedCount}`)
    console.log(`   • Total indexes: ${mergedIndexes.indexes.length}`)
    console.log('')
    console.log(`📄 Merged file saved as: ${outputFile}`)
    console.log('')
    console.log('🚀 To deploy the merged indexes:')
    console.log(`   1. Review the merged file: ${outputFile}`)
    console.log(`   2. Rename it: mv ${outputFile} firestore.indexes.json`)
    console.log('   3. Deploy: firebase deploy --only firestore:indexes')
} catch (error) {
    console.error('❌ Error merging indexes:', error.message)
    process.exit(1)
}
