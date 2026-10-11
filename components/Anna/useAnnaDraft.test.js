import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import useAnnaDraft from './useAnnaDraft'
import { readCommentDraft } from '../../utils/commentDraftStore'
import { installAppResumeListener } from '../../utils/appResume'

const context = { userId: 'draft-user', projectId: 'p1', objectType: 'anna', objectId: 'conversation' }
let root, container, draft, writes, stopLifecycle
function Harness() {
    draft = useAnnaDraft(context)
    return null
}

beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.useFakeTimers()
    localStorage.clear()
    writes = jest.spyOn(Storage.prototype, 'setItem')
    stopLifecycle = installAppResumeListener()
    container = document.createElement('div')
    root = createRoot(container)
    act(() => root.render(<Harness />))
})
afterEach(() => {
    act(() => root.unmount())
    stopLifecycle()
    jest.restoreAllMocks()
    jest.useRealTimers()
    delete global.IS_REACT_ACT_ENVIRONMENT
})

it('keeps the latest text immediately available and saves once after typing pauses', () => {
    act(() => draft.change('First'))
    act(() => jest.advanceTimersByTime(200))
    act(() => draft.change('First draft @CarlMENTION_SPACE_CODECode#assistant-1'))
    expect(draft.draft.current).toBe('First draft @CarlMENTION_SPACE_CODECode#assistant-1')
    expect(draft.hasText).toBe(true)
    expect(writes).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(249))
    expect(writes).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(1))
    expect(writes).toHaveBeenCalledTimes(1)
    expect(readCommentDraft(context).comment).toBe(draft.draft.current)
})

it.each(['pagehide', 'beforeunload', 'visibilitychange', 'freeze'])('flushes the latest draft on %s', event => {
    act(() => draft.change('Preserve before leaving'))
    if (event === 'visibilitychange') jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => (event === 'visibilitychange' || event === 'freeze' ? document : window).dispatchEvent(new Event(event)))
    expect(readCommentDraft(context).comment).toBe('Preserve before leaving')
    act(() => jest.advanceTimersByTime(500))
    expect(writes).toHaveBeenCalledTimes(1)
})

it('flushes on unmount and never lets an old timer overwrite a reopened draft', () => {
    act(() => draft.change('Saved on unmount'))
    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<Harness />))
    expect(draft.initialText).toBe('Saved on unmount')
    act(() => draft.change('New draft'))
    act(() => jest.advanceTimersByTime(250))
    expect(readCommentDraft(context).comment).toBe('New draft')
    expect(writes).toHaveBeenCalledTimes(2)
})

it('clears a sent draft immediately and cancels the scheduled old value', () => {
    act(() => draft.change('Send this now'))
    act(() => draft.change(''))
    expect(draft.hasText).toBe(false)
    expect(readCommentDraft(context).comment).toBe('')
    act(() => jest.advanceTimersByTime(500))
    expect(writes).toHaveBeenCalledTimes(1)
    expect(readCommentDraft(context).comment).toBe('')
})
