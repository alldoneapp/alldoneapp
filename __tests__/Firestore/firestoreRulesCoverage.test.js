const { checkCoverage } = require('../../ci/check-firestore-rule-coverage')

describe('Firestore rules path coverage', () => {
    it('has an explicit top-level rules match for every client collection', () => {
        const { missing } = checkCoverage()

        expect(missing).toEqual([])
    })
})
