/**
 * @jest-environment jsdom
 *
 * AT-2254 regression. A note that opened with a numbered list 1..6 showed a second,
 * unrelated numbered list much further down starting at 7 instead of restarting at 1.
 *
 * Root cause: ordered-list markers are drawn entirely in CSS
 * (`li[data-list=ordered] > .ql-ui::before { content: counter(list-0, decimal) }`), and
 * toolbar-styles.css reset `list-0` on `.ql-editor` and on `p, h1..h6` only. Quill 2
 * renders EVERY list as `<ol>` and keeps the type on `li[data-list]`, so any separator
 * that is not a paragraph or a heading -- a bulleted run, a checklist, a blockquote, a
 * code block, a markdown table, a divider -- never reset the counter and the next
 * numbered list carried on counting.
 *
 * The fix is two rules: reset on the `<ol>` container itself (Quill's ListContainer only
 * accepts ListItem children, so every non-list block necessarily starts a new `<ol>`),
 * plus a `counter-set` on non-ordered list items for the one separator that stays inside
 * the same container.
 *
 * These tests drive a REAL quill 2 instance so the DOM under assertion is the one the
 * browser actually gets, then resolve `list-0` over that DOM using the REAL rules parsed
 * out of toolbar-styles.css. Both halves matter: a hand-written DOM would not prove the
 * selectors match what Quill emits, and asserting on the stylesheet text alone would not
 * prove the numbering comes out right. jsdom computes no counters, which is why the
 * resolution is done here rather than read back off the element.
 */
import fs from 'fs'
import path from 'path'

import postcss from 'postcss'
import Quill from 'quill'

const CSS_PATH = path.join(__dirname, 'toolbar-styles.css')

const COUNTER_PROPS = ['counter-reset', 'counter-set', 'counter-increment']

/**
 * Specificity as (ids, classes/attributes/pseudo-classes, elements). Enough for the
 * selectors in this stylesheet; `:not(...)` contributes its argument's specificity, which
 * is why the wrapper is stripped rather than counted.
 */
const specificityOf = selector => {
    const flattened = selector.replace(/:not\(/g, '')
    const ids = (flattened.match(/#[\w-]+/g) || []).length
    const classes = (flattened.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+(?!\()/g) || []).length
    const elements = (flattened.match(/(^|[\s>+~(])[a-z][\w-]*/gi) || []).length
    return [ids, classes, elements]
}

const isMoreSpecific = (a, b) => {
    for (let index = 0; index < 3; index++) {
        if (a.specificity[index] !== b.specificity[index]) return a.specificity[index] > b.specificity[index]
    }
    return a.order >= b.order // later source order wins ties
}

/**
 * Collect every counter declaration, one entry per selector in a selector list, tagged
 * with the specificity and source order needed to resolve the cascade.
 *
 * Rules nested in `@supports not (counter-set: none)` are skipped: that block is the
 * legacy-Safari fallback, and the engines this resolver models support counter-set.
 */
const collectCounterDeclarations = () => {
    const root = postcss.parse(fs.readFileSync(CSS_PATH, 'utf8'))
    const declarations = []
    let order = 0

    root.walkRules(rule => {
        const parent = rule.parent
        if (parent && parent.type === 'atrule' && /not\s*\(counter-set/.test(parent.params)) return

        rule.walkDecls(decl => {
            if (!COUNTER_PROPS.includes(decl.prop)) return

            // Pseudo-element selectors only ever carry `content`; drop them so jsdom's
            // matches() is never handed a selector it cannot parse.
            rule.selector
                .split(',')
                .map(selector => selector.trim().replace(/::?(before|after)\b/g, ''))
                .filter(Boolean)
                .forEach(selector => {
                    declarations.push({
                        selector,
                        prop: decl.prop,
                        touchesList0: /(^|\s)list-0(\s|$)/.test(decl.value),
                        specificity: specificityOf(selector),
                        order: order++,
                    })
                })
        })
    })

    return declarations
}

/**
 * The winning declaration for one property on one element, or null. This is the part that
 * makes the model faithful: `li[data-list=ordered].ql-indent-1` sets
 * `counter-increment: list-1`, which OVERRIDES the `list-0` increment from the less
 * specific `li[data-list=ordered]` rather than adding to it.
 */
const winningDeclaration = (element, declarations, prop) =>
    declarations
        .filter(declaration => declaration.prop === prop)
        .filter(declaration => {
            try {
                return element.matches(declaration.selector)
            } catch (error) {
                return false
            }
        })
        .reduce((winner, candidate) => (winner === null || isMoreSpecific(candidate, winner) ? candidate : winner), null)

/**
 * Resolve the rendered number of every ordered list item.
 *
 * Walking in document order is a faithful simplification for Quill's editor DOM
 * specifically: blocks are all direct children of `.ql-editor` and list items are all
 * direct children of an `<ol>`, so a counter created on an element is in scope for
 * everything that follows it in document order either as a descendant or as a following
 * sibling. There is no nesting that could scope a counter away again -- Quill 2's
 * ListContainer.allowedChildren is [ListItem], so `<ol>` never contains another `<ol>`.
 */
const resolveOrderedNumbers = editorRoot => {
    const declarations = collectCounterDeclarations()
    const numbers = []
    let counter = 0

    const visit = element => {
        // CSS applies counter-reset, then counter-set, then counter-increment.
        const reset = winningDeclaration(element, declarations, 'counter-reset')
        if (reset !== null && reset.touchesList0) counter = 0

        const set = winningDeclaration(element, declarations, 'counter-set')
        if (set !== null && set.touchesList0) counter = 0

        const increment = winningDeclaration(element, declarations, 'counter-increment')
        if (increment !== null && increment.touchesList0) counter += 1

        // Only top-level ordered items render `counter(list-0)`. An indented item's
        // marker is drawn from list-1/list-2/... by the indent chain, so it is not part
        // of the sequence under test here.
        if (element.matches("li[data-list='ordered']:not([class*='ql-indent-'])")) numbers.push(counter)

        Array.from(element.children).forEach(visit)
    }

    visit(editorRoot)
    return numbers
}

const buildEditor = ops => {
    document.body.innerHTML = '<div id="editor"></div>'
    const quill = new Quill(document.getElementById('editor'))
    quill.setContents(ops)
    return document.querySelector('.ql-editor')
}

const orderedItems = (...texts) => texts.map(text => [{ insert: text }, { insert: '\n', attributes: { list: 'ordered' } }]).flat()

const listItems = (type, ...texts) => texts.map(text => [{ insert: text }, { insert: '\n', attributes: { list: type } }]).flat()

describe('AT-2254 ordered list numbering restarts after a separator', () => {
    /**
     * The reported shape. The separator has to be something other than a paragraph or a
     * heading, because those two already reset the counter before this fix -- which is
     * also why the bug needs an unbroken run of non-resetting blocks to survive as far
     * down a note as it did. Bullets are the likeliest such run in an assistant-written
     * note: markdownToYjs emits headings, paragraphs, lists and tables, and only the last
     * two fail to reset.
     */
    it('reproduces the reported note: 1..6, bullets, then a fresh list starting at 1', () => {
        const editor = buildEditor([
            ...orderedItems('one', 'two', 'three', 'four', 'five', 'six'),
            ...listItems('bullet', 'an aside', 'another aside'),
            ...orderedItems('first again', 'second again'),
        ])

        expect(resolveOrderedNumbers(editor)).toEqual([1, 2, 3, 4, 5, 6, 1, 2])
    })

    // The separators below are the ones that were broken: none of them is a paragraph or
    // a heading, so before the fix every one of them let the counter run on.
    it.each([
        ['a bulleted list', () => listItems('bullet', 'a bullet', 'another bullet')],
        ['a checklist', () => listItems('unchecked', 'a todo')],
        ['a checked checklist', () => listItems('checked', 'a done todo')],
        ['a blockquote', () => [{ insert: 'quoted' }, { insert: '\n', attributes: { blockquote: true } }]],
        ['a code block', () => [{ insert: 'const x = 1' }, { insert: '\n', attributes: { 'code-block': true } }]],
    ])('restarts at 1 after %s', (_label, separator) => {
        const editor = buildEditor([...orderedItems('one', 'two', 'three'), ...separator(), ...orderedItems('one again', 'two again')])

        expect(resolveOrderedNumbers(editor)).toEqual([1, 2, 3, 1, 2])
    })

    // These two already worked; they are the guard against a fix that over-resets.
    it.each([
        ['a paragraph', () => [{ insert: 'prose\n' }]],
        ['a heading', () => [{ insert: 'A heading' }, { insert: '\n', attributes: { header: 2 } }]],
    ])('still restarts at 1 after %s', (_label, separator) => {
        const editor = buildEditor([...orderedItems('one', 'two', 'three'), ...separator(), ...orderedItems('one again', 'two again')])

        expect(resolveOrderedNumbers(editor)).toEqual([1, 2, 3, 1, 2])
    })

    it('preserves intentional continuation: an uninterrupted list keeps counting', () => {
        const editor = buildEditor(orderedItems('one', 'two', 'three', 'four', 'five', 'six'))

        expect(resolveOrderedNumbers(editor)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('keeps counting across a nested sub-item, which does not end the list', () => {
        const editor = buildEditor([
            { insert: 'one' },
            { insert: '\n', attributes: { list: 'ordered' } },
            { insert: 'a sub point' },
            { insert: '\n', attributes: { list: 'ordered', indent: 1 } },
            { insert: 'two' },
            { insert: '\n', attributes: { list: 'ordered' } },
        ])

        // The indented item increments list-1, not list-0, so the outer run is 1, 2.
        expect(resolveOrderedNumbers(editor)).toEqual([1, 2])
    })
})
