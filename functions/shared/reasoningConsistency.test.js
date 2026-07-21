const { extractDistinctiveTokens, reasoningReferencesDifferentOption } = require('./reasoningConsistency')

describe('reasoningConsistency', () => {
    describe('extractDistinctiveTokens', () => {
        test('drops generic stopwords, short tokens, pure numbers, and the Alldone/ prefix', () => {
            expect(extractDistinctiveTokens('Alldone/JTL Software – Project Juno 2024')).toEqual(['jtl', 'juno'])
        })

        test('returns nothing for an all-stopword name', () => {
            expect(extractDistinctiveTokens('Project Software Team')).toEqual([])
        })
    })

    describe('reasoningReferencesDifferentOption', () => {
        const labels = [
            { key: 'project_bechtle', names: ['Bechtle', 'project_bechtle'] },
            { key: 'project_jtl', names: ['JTL Software – Project Juno', 'project_jtl'] },
        ]

        test('flags a positively assigned full mention of a different option', () => {
            expect(
                reasoningReferencesDifferentOption(
                    'Clearly about JTL Software – Project Juno.',
                    'project_bechtle',
                    labels
                )
            ).toEqual({ otherKey: 'project_jtl', token: 'jtl' })
        })

        test('ignores a bare mention of a different option without an assignment relationship', () => {
            const strictMode = { requirePositiveRelationship: true }
            const options = [
                ...labels,
                { key: 'product', names: ['Product'] },
                { key: 'business', names: ['Business'] },
            ]

            expect(
                reasoningReferencesDifferentOption(
                    'The email mentions the Product roadmap and was sent to the Business team.',
                    'project_bechtle',
                    options,
                    strictMode
                )
            ).toBeNull()
            expect(
                reasoningReferencesDifferentOption(
                    'The email is a newsletter that happens to mention Product.',
                    'business',
                    options,
                    strictMode
                )
            ).toBeNull()
        })

        test('flags common positive assignment phrases', () => {
            const options = [
                { key: 'business', names: ['Business'] },
                { key: 'product', names: ['Product'] },
            ]

            expect(
                reasoningReferencesDifferentOption('This should be labeled as Product.', 'business', options, {
                    requirePositiveRelationship: true,
                })
            ).toEqual({ otherKey: 'product', token: 'product' })
            expect(
                reasoningReferencesDifferentOption('Product is the correct label.', 'business', options, {
                    requirePositiveRelationship: true,
                })
            ).toEqual({ otherKey: 'product', token: 'product' })
            expect(
                reasoningReferencesDifferentOption('This aligns best with Product.', 'business', options, {
                    requirePositiveRelationship: true,
                })
            ).toEqual({ otherKey: 'product', token: 'product' })
        })

        test('flags a partial token mention of a different option', () => {
            expect(
                reasoningReferencesDifferentOption('This belongs to the JTL workstream.', 'project_bechtle', labels)
            ).toEqual({ otherKey: 'project_jtl', token: 'jtl' })
        })

        test('returns null when the reasoning only references the chosen option', () => {
            expect(
                reasoningReferencesDifferentOption('A Bechtle procurement confirmation.', 'project_bechtle', labels)
            ).toBeNull()
        })

        test('returns null when no option is referenced', () => {
            expect(
                reasoningReferencesDifferentOption('A generic project update for the team.', 'project_bechtle', labels)
            ).toBeNull()
        })

        test('ignores labels mentioned only as rejected alternatives', () => {
            const options = [
                { key: 'privat', names: ['Privat'] },
                { key: 'ads', names: ['Ads'] },
            ]
            expect(
                reasoningReferencesDifferentOption('This belongs to Privat rather than Ads.', 'privat', options)
            ).toBeNull()
            expect(reasoningReferencesDifferentOption('This should not be Ads.', 'privat', options)).toBeNull()
            expect(reasoningReferencesDifferentOption('Ads does not apply here.', 'privat', options)).toBeNull()
        })

        test('still flags a positive option after a rejected alternative', () => {
            const options = [
                { key: 'ads', names: ['Ads'] },
                { key: 'privat', names: ['Privat'] },
            ]
            expect(reasoningReferencesDifferentOption('Not Ads, but clearly Privat.', 'ads', options)).toEqual({
                otherKey: 'privat',
                token: 'privat',
            })
        })

        test('ignores tokens that also belong to the chosen option', () => {
            const overlapping = [
                { key: 'a', names: ['JTL Core'] },
                { key: 'b', names: ['JTL Edge'] },
            ]
            // "jtl" is shared, so a mention of "JTL" alone must not flag the other option.
            expect(reasoningReferencesDifferentOption('About JTL generally.', 'a', overlapping)).toBeNull()
        })

        test('handles empty reasoning and empty options', () => {
            expect(reasoningReferencesDifferentOption('', 'a', labels)).toBeNull()
            expect(reasoningReferencesDifferentOption('JTL stuff', 'a', [])).toBeNull()
        })
    })
})
