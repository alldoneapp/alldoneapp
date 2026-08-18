const {
    getAssistantTemplateReviewCount,
    hasAssistantTemplateReview,
    getAssistantTemplateReviewLabelKey,
} = require('./templateReview')

describe('assistant template review gate (AT-2358)', () => {
    test('counts pending conflicts on a template-linked assistant', () => {
        const assistant = {
            copiedFromTemplateAssistantId: 'template-1',
            templateSyncConflicts: [{ field: 'instructions' }, { field: 'model' }],
        }
        expect(getAssistantTemplateReviewCount(assistant)).toBe(2)
        expect(hasAssistantTemplateReview(assistant)).toBe(true)
    })

    test('reports nothing to review once conflicts are resolved', () => {
        const assistant = { copiedFromTemplateAssistantId: 'template-1', templateSyncConflicts: [] }
        expect(getAssistantTemplateReviewCount(assistant)).toBe(0)
        expect(hasAssistantTemplateReview(assistant)).toBe(false)
    })

    test('ignores conflicts left on an assistant that is no longer linked to a template', () => {
        // UpdateFromTemplate renders nothing without the link, so a badge here
        // would point at a panel the user cannot open.
        const assistant = { templateSyncConflicts: [{ field: 'instructions' }] }
        expect(getAssistantTemplateReviewCount(assistant)).toBe(0)
    })

    test('survives missing, null and malformed assistants without throwing', () => {
        expect(getAssistantTemplateReviewCount(undefined)).toBe(0)
        expect(getAssistantTemplateReviewCount(null)).toBe(0)
        expect(getAssistantTemplateReviewCount({ copiedFromTemplateAssistantId: 'template-1' })).toBe(0)
        expect(
            getAssistantTemplateReviewCount({
                copiedFromTemplateAssistantId: 'template-1',
                templateSyncConflicts: 'not-an-array',
            })
        ).toBe(0)
    })

    test('uses the existing translated singular and plural keys', () => {
        expect(getAssistantTemplateReviewLabelKey(1)).toBe('template change needs review')
        expect(getAssistantTemplateReviewLabelKey(2)).toBe('template changes need review')
    })
})
