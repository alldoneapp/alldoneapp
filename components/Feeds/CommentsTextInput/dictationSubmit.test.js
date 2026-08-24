/**
 * @jest-environment jsdom
 *
 * How a push-to-talk dictation reaches each input's existing submit action (AT-2405), and WHEN.
 *
 * The product rule is "hold-to-send works everywhere an Enter-submit already exists", and the way
 * that is achieved without touching ~30 host components is by reusing the Enter action they
 * already pass down. `resolveDictationSubmit`'s precedence is half of the contract.
 *
 * The other half — and the production bug this file now pins — is the TIMING. Those host actions
 * are closures over host state, and a dictation arrives in one shot: the transcript insertion
 * calls `onChangeText`, the host calls `setState`, and React 18 only QUEUES that update because
 * the transcript is delivered from a promise continuation. Resolving and calling the host action
 * in that same tick therefore runs the PRE-dictation closure, which cannot see a word of what was
 * just dictated.
 *
 * In the add-new-task field that closure read `hasName === false` and took the branch that
 * DISMISSES the editor, so holding the mic closed the input, created no task, and left the
 * dictated text behind to reappear the next time the field was opened. The original fix hopped a
 * macrotask before calling, which changed nothing: the hop lets React commit, but the callback had
 * already been bound to the stale closure.
 *
 * So the tests below are about identity, not about delay — "which closure ran", not "how long
 * later". `useDictationSubmit` must fire after a commit AND resolve the host action at that
 * moment.
 */
import fs from 'fs'
import path from 'path'
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useDictationSubmit, { resolveDictationSubmit } from './dictationSubmit'

describe('resolveDictationSubmit', () => {
    test('an explicit onDictationSubmit receives the text', () => {
        const onDictationSubmit = jest.fn()

        resolveDictationSubmit({ onDictationSubmit })('draft plus transcript')

        expect(onDictationSubmit).toHaveBeenCalledWith('draft plus transcript')
    })

    test('otherwise it falls back to the generic Enter action used by ~40 hosts', () => {
        const forceTriggerEnterActionForBreakLines = jest.fn()

        resolveDictationSubmit({ forceTriggerEnterActionForBreakLines })('ignored')

        // That callback takes no arguments — it is the same one CustomTextInput3 fires when a
        // newline is inserted, and those hosts read their own state. Passing the text would be a
        // new contract for 40 components.
        expect(forceTriggerEnterActionForBreakLines).toHaveBeenCalledWith()
    })

    test('the explicit hook wins when a host offers both', () => {
        const onDictationSubmit = jest.fn()
        const forceTriggerEnterActionForBreakLines = jest.fn()

        resolveDictationSubmit({ onDictationSubmit, forceTriggerEnterActionForBreakLines })('text')

        expect(onDictationSubmit).toHaveBeenCalled()
        expect(forceTriggerEnterActionForBreakLines).not.toHaveBeenCalled()
    })

    test('an input with no submit of its own returns null and simply inserts', () => {
        // The notes document editor is the case: there is nothing to submit, so holding the mic
        // must dictate and stop there rather than inventing an action.
        expect(resolveDictationSubmit({})).toBeNull()
        expect(resolveDictationSubmit()).toBeNull()
        expect(resolveDictationSubmit({ onDictationSubmit: 'not a function' })).toBeNull()
    })
})

/**
 * A stand-in for a host that owns the draft and hands its input an Enter action which reads it —
 * the shape of EditTask, EditGoal, EditContact and every other generic host. `onChangeText` is
 * what the transcript insertion triggers; `enterAction` is `forceTriggerEnterActionForBreakLines`.
 */
const buildHarness = ({ submitsWith = 'enterAction' } = {}) => {
    const seen = []
    let dictate = null
    let renderCount = 0

    const Input = ({ text, enterAction }) => {
        renderCount++
        const armDictationSubmit = useDictationSubmit(
            submitsWith === 'enterAction'
                ? { forceTriggerEnterActionForBreakLines: enterAction }
                : { onDictationSubmit: enterAction }
        )
        // Exactly what CustomTextInput3 does: the text is read through a getter at fire time,
        // because it lives in a ref written synchronously during insertion.
        dictate = getText => armDictationSubmit(getText)
        return null
    }

    const Host = () => {
        const [draft, setDraft] = React.useState('')
        // Rebuilt every render and closing over `draft` — this is the whole point. The pre-fix
        // implementation captured the render-0 copy of this function, which sees ''.
        const enterAction = value => seen.push(value !== undefined ? value : draft)
        return <Input text={draft} enterAction={enterAction} onChangeText={setDraft} setDraft={setDraft} />
    }

    let tree
    act(() => {
        tree = renderer.create(<Host />)
    })

    // The recorder's completion, reproduced in one synchronous block: insert the transcript (which
    // pushes it into the host's state) and then ask the input to submit.
    const holdMicAndRelease = transcript => {
        act(() => {
            tree.root.findByType(Input).props.onChangeText(transcript)
            dictate(() => transcript)
        })
    }

    return { seen, holdMicAndRelease, dictate, tree, renderCountAtStart: renderCount }
}

describe('useDictationSubmit', () => {
    test('the host action that runs can see the dictated text (the add-new-task regression)', () => {
        const { seen, holdMicAndRelease } = buildHarness()

        holdMicAndRelease('Buy milk')

        // Pre-fix this was [''] — the render-0 closure, i.e. an empty draft. In EditTask that empty
        // draft is what made the editor dismiss itself instead of creating the task.
        expect(seen).toEqual(['Buy milk'])
    })

    test('nothing is submitted in the arming tick', () => {
        const seen = []
        let armDictationSubmit = null
        const Input = () => {
            armDictationSubmit = useDictationSubmit({ forceTriggerEnterActionForBreakLines: () => seen.push('fired') })
            return null
        }
        act(() => {
            renderer.create(<Input />)
        })

        act(() => {
            armDictationSubmit(() => 'text')
            // Arming must not have submitted anything yet: the host's own state update is queued
            // in this very batch and has not been rendered, which is the entire failure mode.
            seen.push('armed')
        })

        expect(seen).toEqual(['armed', 'fired'])
    })

    test('an explicit onDictationSubmit receives the text read at fire time', () => {
        const { seen, holdMicAndRelease } = buildHarness({ submitsWith: 'onDictationSubmit' })

        holdMicAndRelease('draft plus transcript')

        expect(seen).toEqual(['draft plus transcript'])
    })

    test('one hold submits exactly once, even though the submit re-renders the input', () => {
        // Every real host action re-renders this subtree (it creates a task, saves a goal, closes
        // the editor). If the post-commit effect did not clear its pending flag first, that
        // re-render would submit again — two tasks from one dictation.
        const seen = []
        let armDictationSubmit = null
        const Input = ({ onEnter }) => {
            armDictationSubmit = useDictationSubmit({ forceTriggerEnterActionForBreakLines: onEnter })
            return null
        }
        const Host = () => {
            const [saves, setSaves] = React.useState(0)
            const onEnter = () => {
                seen.push('submit')
                setSaves(count => count + 1)
            }
            return <Input saves={saves} onEnter={onEnter} />
        }
        act(() => {
            renderer.create(<Host />)
        })

        act(() => {
            armDictationSubmit(() => 'once')
        })

        expect(seen).toEqual(['submit'])
    })

    test('a host with no submit of its own arms harmlessly', () => {
        let armDictationSubmit = null
        const Input = () => {
            armDictationSubmit = useDictationSubmit({})
            return null
        }
        act(() => {
            renderer.create(<Input />)
        })

        expect(() =>
            act(() => {
                armDictationSubmit(() => 'notes document editor')
            })
        ).not.toThrow()
    })

    test('a plain string may be armed instead of a getter', () => {
        const seen = []
        let armDictationSubmit = null
        const Input = () => {
            armDictationSubmit = useDictationSubmit({ onDictationSubmit: text => seen.push(text) })
            return null
        }
        act(() => {
            renderer.create(<Input />)
        })

        act(() => {
            armDictationSubmit('literal')
        })

        expect(seen).toEqual(['literal'])
    })
})

/**
 * A ratchet, not a behaviour test. Nothing renders the real CustomTextInput3 (it needs quill, the
 * store and half the mention system), so the one thing that would silently reintroduce the bug —
 * "simplifying" the arming back into a direct call in the tick the transcript lands — is pinned
 * here on the source instead. The hook exists precisely because that direct call runs the host's
 * pre-dictation closure.
 */
describe('CustomTextInput3 wiring', () => {
    const source = fs.readFileSync(path.join(__dirname, 'CustomTextInput3.js'), 'utf8')

    test('the dictation submit is armed for after the commit, never called inline', () => {
        expect(source).toContain('armDictationSubmit(() => textRef.current)')
        expect(source).not.toContain('resolveDictationSubmit(')
        expect(source).not.toContain('scheduleDictationSubmit')
    })

    test('the mic still hands its transcript and its submit to the same input', () => {
        expect(source).toContain('onTextReady={insertDictatedText}')
        expect(source).toContain('onSubmit={submitDictatedText}')
    })
})
