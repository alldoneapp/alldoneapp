/**
 * Single gate for "this assistant has template changes waiting to be reviewed".
 *
 * A derived assistant that conflicts with its template applies nothing until a
 * human picks a side, so the review is the only thing standing between a template
 * edit and the copy. Before AT-2358 that state was reachable only by opening the
 * assistant, which is why every surface must agree on one predicate rather than
 * re-deriving it from `templateSyncConflicts` inline.
 *
 * The link to the template (`copiedFromTemplateAssistantId`) is required: a stale
 * conflicts array left on an unlinked assistant is not a pending review, and
 * `UpdateFromTemplate` would render nothing for it anyway.
 */
export const getAssistantTemplateReviewCount = assistant => {
    if (!assistant || !assistant.copiedFromTemplateAssistantId) return 0
    const { templateSyncConflicts } = assistant
    return Array.isArray(templateSyncConflicts) ? templateSyncConflicts.length : 0
}

export const hasAssistantTemplateReview = assistant => getAssistantTemplateReviewCount(assistant) > 0

export const getAssistantTemplateReviewLabelKey = count =>
    count === 1 ? 'template change needs review' : 'template changes need review'
