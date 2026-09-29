import { readCommentDraft, saveCommentDraft, clearCommentDraft, hasUnsafeCommentDrafts } from './commentDraftStore'
const context = { userId: 'user', projectId: 'project', objectType: 'tasks', objectId: 'task' }
beforeEach(() => localStorage.clear())
it('restores a draft including its text and composer metadata', () => {
    const draft = { comment: 'arguments', privacy: true, mentions: ['someone'], hasKarma: false }
    expect(saveCommentDraft(context, draft)).toBe(true)
    expect(readCommentDraft(context)).toEqual(draft)
    expect(readCommentDraft({ ...context, userId: 'other' })).toBeNull()
})
it('does not remove a newer draft when an older send finishes', () => {
    saveCommentDraft(context, { comment: 'newer' })
    clearCommentDraft(context, 'older')
    expect(readCommentDraft(context).comment).toBe('newer')
    clearCommentDraft(context, 'newer')
    expect(readCommentDraft(context).comment).toBe('')
})
it('holds automatic reload while a failed local write leaves the only copy in memory', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw Error('quota')
    })
    expect(saveCommentDraft(context, { comment: 'not yet on disk' })).toBe(false)
    expect(hasUnsafeCommentDrafts()).toBe(true)
    expect(readCommentDraft(context).comment).toBe('not yet on disk')
    spy.mockRestore()
    expect(saveCommentDraft(context, { comment: 'not yet on disk' })).toBe(true)
    expect(hasUnsafeCommentDrafts()).toBe(false)
})
