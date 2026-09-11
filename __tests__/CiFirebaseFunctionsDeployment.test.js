'use strict'

const fs = require('fs')
const path = require('path')

const {
    deployedFunctionNames,
    exportedFunctionNames,
    findMissingFunctions,
} = require('../ci/assertFirebaseFunctionsDeployed')

describe('Firebase Functions deployment verification', () => {
    const source = `
exports.moveTaskToProjectSecondGen = onCall({}, handler)
exports.runManualTaskProjectMove = onTaskDispatched({}, worker)
`

    it('accepts the JSON envelope emitted by firebase functions:list', () => {
        const payload = {
            status: 'success',
            result: [{ id: 'moveTaskToProjectSecondGen' }, { id: 'runManualTaskProjectMove' }],
        }

        expect(findMissingFunctions(source, payload)).toEqual([])
        expect([...deployedFunctionNames(payload)]).toEqual(['moveTaskToProjectSecondGen', 'runManualTaskProjectMove'])
    })

    it('fails closed when a partially successful deploy omitted the task worker', () => {
        const payload = { status: 'success', result: [{ id: 'moveTaskToProjectSecondGen' }] }

        expect(findMissingFunctions(source, payload)).toEqual(['runManualTaskProjectMove'])
    })

    it('recognizes every static export in the real Functions entry point', () => {
        const indexSource = fs.readFileSync(path.resolve(__dirname, '../functions/index.js'), 'utf8')
        const names = exportedFunctionNames(indexSource)

        expect(names).toContain('moveTaskToProjectSecondGen')
        expect(names).toContain('runManualTaskProjectMove')
        expect(new Set(names).size).toBe(names.length)
    })

    it('rejects an unexpected list payload instead of treating it as an empty success', () => {
        expect(() => deployedFunctionNames({ status: 'success' })).toThrow(
            'Firebase functions:list returned an unexpected payload'
        )
    })
})
