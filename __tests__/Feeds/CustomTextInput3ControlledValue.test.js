/**
 * AT-2178 guard.
 *
 * `CustomTextInput3` fills its Quill editor imperatively (`setContents` /
 * `updateContents`) while ALSO handing react-quill a controlled `value`.
 * react-quill overwrites the editor whenever that value disagrees with the
 * editor's contents, so the value must be updated SYNCHRONOUSLY with the
 * imperative write. React state is not: a re-render flushed from elsewhere
 * (a redux dispatch, or the synchronous relayout CustomScrollView performs
 * after measuring) can land before the queued `setHtml`, and react-quill then
 * wipes the editor. That is what emptied the create-task popup after a note
 * selection was copied into it.
 *
 * The behavioural regression test for this lives in
 * `browser-tests/at2178/run.js` and needs a real browser (jsdom in this repo has
 * no Range/Selection, so Quill cannot even be instantiated here — see the
 * `document.getSelection is not a function` failure). This test therefore guards
 * the structural invariant that the browser test proved is required, so a future
 * edit cannot silently reintroduce the lag in a job CI actually runs.
 *
 * Same approach as `__tests__/WebShellScrollContainers.test.js`, which guards the
 * shell templates by reading them.
 */
const fs = require('fs')
const path = require('path')

const SOURCE = path.join(__dirname, '..', '..', 'components', 'Feeds', 'CommentsTextInput', 'CustomTextInput3.js')

describe('CustomTextInput3 controlled value (AT-2178)', () => {
    const source = fs.readFileSync(SOURCE, 'utf8')

    it('passes react-quill a synchronously updated value, not the lagging state', () => {
        expect(source).toContain('value={htmlRef.current}')
        expect(source).not.toMatch(/\n\s*value=\{html\}/)
    })

    it('keeps the ref and the state in lockstep through a single setter', () => {
        expect(source).toMatch(/const setHtml = value => \{\s*htmlRef\.current = value\s*setHtmlState\(value\)\s*\}/)
    })

    it('does not call the raw state setter anywhere else', () => {
        const rawSetterCalls = source.match(/setHtmlState\(/g) || []
        // Only the one inside `setHtml`.
        expect(rawSetterCalls).toHaveLength(1)
    })
})
