import Delta from 'quill-delta'
import { noteDeltaWork } from './noteDeltaWork'

const before = new Delta()
    .insert('hello ')
    .insert({ taskTagFormat: { taskId: 't1' } })
    .insert(' world\n')
it('does not scan links when typing, formatting or deleting ordinary text', () => {
    expect(noteDeltaWork(new Delta().retain(2).insert('x'), before)).toEqual({
        links: false,
        text: true,
        removedTasks: false,
    })
    expect(noteDeltaWork(new Delta().retain(3, { bold: true }), before)).toEqual({
        links: false,
        text: false,
        removedTasks: false,
    })
    expect(noteDeltaWork(new Delta().delete(3), before)).toEqual({ links: false, text: true, removedTasks: false })
})
it('invalidates links and task membership only when their deleted span contains an embed', () => {
    expect(noteDeltaWork(new Delta().retain(6).delete(1), before)).toEqual({
        links: true,
        text: false,
        removedTasks: true,
    })
    expect(noteDeltaWork(new Delta().retain(7).delete(3), before).links).toBe(false)
})
it.each(['mention', 'url', 'taskTagFormat'])('invalidates inserted %s', format => {
    expect(noteDeltaWork(new Delta().insert({ [format]: {} }), before).links).toBe(true)
})
it('does not invalidate links for image insertion, and conservatively handles a missing previous Delta', () => {
    expect(noteDeltaWork(new Delta().insert({ image: 'x' }), before).links).toBe(false)
    expect(noteDeltaWork(new Delta().delete(1), null)).toEqual({ links: true, text: true, removedTasks: true })
})
