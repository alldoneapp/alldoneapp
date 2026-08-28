/**
 * @jest-environment jsdom
 *
 * AT-2454. A task embedded in a note sometimes went blank while the note around it was being
 * edited, and came back on reload — i.e. the blot and its Yjs entry were intact and only the
 * rendered content was gone.
 *
 * These tests drive a REAL quill 2 with REAL `ReactDOM.render` roots inside real embeds,
 * because the defect only exists in how the two compose: `blots/embed`'s constructor moves
 * everything `create()` rendered into a private `contentNode` immediately after `create()`
 * returns, so React's container stops being the parent of React's own children. A test against
 * a quill double cannot express that at all.
 *
 * Each fix is paired with the unfixed shape, so the tests prove the defect rather than
 * restating the fix.
 */
import React from 'react'
import ReactDOM from 'react-dom'
import Quill from 'quill'

import { EMBED_REACT_ROOT_CLASS, getEmbedReactRoot, renderEmbedContent } from './embedReactRoot'

const Embed = Quill.import('blots/embed')

const GUARD = '﻿'

// Component controls, assigned on render so a test can drive the mounted tree.
const controls = {}

// Mimics the AppPopover shape: below the sheet breakpoint the wrapper renders a fragment with
// the trigger plus a portal-backed sheet, above it a single element — a container-level
// structural change of the React ROOT.
function StructuralSwitch({ id }) {
    const [asSheet, setAsSheet] = React.useState(false)
    controls[id] = { setAsSheet }
    if (asSheet) return React.createElement('div', { className: 'sheet' }, 'sheet content')
    return React.createElement('span', { className: 'popover' }, 'popover content')
}

// Mimics a component whose FIRST render produces no host element and whose real content only
// arrives from a state update (TaskTag rendered `null` until its name was resolved).
function LateContent({ id }) {
    const [ready, setReady] = React.useState(false)
    controls[id] = { setReady }
    if (!ready) return null
    return React.createElement('div', { className: 'late' }, 'late content')
}

const defineBlot = (blotName, render) => {
    class Fmt extends Embed {
        static create(data) {
            const node = super.create(blotName)
            node.setAttribute('data-id', data.id)
            node.setAttribute('contenteditable', false)
            render(node, data)
            return node
        }
        static value(domNode) {
            return { id: domNode.getAttribute('data-id') }
        }
    }
    Fmt.blotName = blotName
    Fmt.className = `ql-${blotName}`
    Fmt.tagName = 'span'
    Quill.register(Fmt, true)
    return Fmt
}

// Fixed shape — renders through the shared mount node.
defineBlot('fixedSwitch', (node, data) =>
    renderEmbedContent(node, React.createElement(StructuralSwitch, { id: data.id }))
)
defineBlot('fixedLate', (node, data) => renderEmbedContent(node, React.createElement(LateContent, { id: data.id })))
// Unfixed shape — renders straight into the blot's own domNode, as every blot used to.
defineBlot('legacySwitch', (node, data) =>
    ReactDOM.render(React.createElement(StructuralSwitch, { id: data.id }), node)
)
defineBlot('legacyLate', (node, data) => ReactDOM.render(React.createElement(LateContent, { id: data.id }), node))
// Renders nothing at create() time; the content arrives later, like url.js's async callback.
defineBlot('legacyDeferred', () => {})
defineBlot('fixedDeferred', () => {})

const buildEditor = () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    return new Quill(host)
}

const insertEmbed = (quill, blotName, id) => {
    quill.setContents([{ insert: 'before ' }, { insert: { [blotName]: { id } } }, { insert: ' after\n' }])
    return quill.root.querySelector(`span.ql-${blotName}`)
}

const contentNodeOf = embedNode => embedNode.querySelector('span[contenteditable="false"]')

describe('a React root inside a quill 2 embed', () => {
    afterEach(() => {
        document.body.innerHTML = ''
        Object.keys(controls).forEach(key => delete controls[key])
    })

    it('keeps quill from relocating React content away from its container', () => {
        const quill = buildEditor()
        const embed = insertEmbed(quill, 'fixedSwitch', 'a')

        const mountNode = getEmbedReactRoot(embed)
        expect(mountNode).not.toBeNull()
        // Quill moved the mount node into contentNode; React's children came with it.
        expect(contentNodeOf(embed).contains(mountNode)).toBe(true)
        expect(mountNode.querySelector('.popover')).not.toBeNull()
    })

    it('survives a container-level structural swap instead of blanking the embed', () => {
        const quill = buildEditor()
        const embed = insertEmbed(quill, 'fixedSwitch', 'b')

        expect(() => {
            ReactDOM.unstable_batchedUpdates(() => controls.b.setAsSheet(true))
        }).not.toThrow()

        expect(embed.querySelector('.sheet')).not.toBeNull()
        expect(embed.querySelector('.popover')).toBeNull()
        // The blot itself is untouched.
        expect(quill.getContents().ops[1].insert.fixedSwitch).toEqual({ id: 'b' })
    })

    it('reproduces the defect without the mount node: the swap throws in commit', () => {
        const quill = buildEditor()
        const embed = insertEmbed(quill, 'legacySwitch', 'c')
        expect(embed.querySelector('.popover')).not.toBeNull()

        let thrown = null
        try {
            ReactDOM.unstable_batchedUpdates(() => controls.c.setAsSheet(true))
        } catch (error) {
            thrown = error
        }

        expect(thrown).not.toBeNull()
        expect(String(thrown.message)).toMatch(/not a child of this node/i)
        // The new content never lands, which is what the user sees as a frozen / blank tag.
        expect(embed.querySelector('.sheet')).toBeNull()
    })

    it('puts late content inside contentNode, not after the right guard', () => {
        const quill = buildEditor()
        const embed = insertEmbed(quill, 'fixedLate', 'd')

        ReactDOM.unstable_batchedUpdates(() => controls.d.setReady(true))

        const late = embed.querySelector('.late')
        expect(late).not.toBeNull()
        expect(contentNodeOf(embed).contains(late)).toBe(true)
    })

    it('reproduces the defect without the mount node: late content escapes contentNode', () => {
        const quill = buildEditor()
        const embed = insertEmbed(quill, 'legacyLate', 'e')

        ReactDOM.unstable_batchedUpdates(() => controls.e.setReady(true))

        const late = embed.querySelector('.late')
        expect(late).not.toBeNull()
        // It landed as a sibling of quill's guards instead of inside the non-editable content.
        expect(contentNodeOf(embed).contains(late)).toBe(false)
        expect(late.parentNode).toBe(embed)
    })

    it('renders twice into the same root without destroying quill’s cursor guards', () => {
        const quill = buildEditor()
        const embed = insertEmbed(quill, 'fixedLate', 'f')
        const mountNode = getEmbedReactRoot(embed)

        renderEmbedContent(embed, React.createElement('b', { className: 'second' }, 'second render'))

        expect(getEmbedReactRoot(embed)).toBe(mountNode)
        expect(embed.querySelector('.second')).not.toBeNull()
        expect(embed.firstChild.data).toBe(GUARD)
        expect(embed.lastChild.data).toBe(GUARD)
        expect(contentNodeOf(embed)).not.toBeNull()
        expect(embed.querySelectorAll(`.${EMBED_REACT_ROOT_CLASS}`)).toHaveLength(1)
    })

    it('reproduces the defect without the mount node: an async first render eats the guards', () => {
        // url.js renders from a `Backend.getObjectFromUrl` callback, so for a note/contact/goal
        // link the ONLY render happens after the blot has been constructed. React 18 empties a
        // container it is mounting into for the first time — here that is quill's left guard,
        // contentNode and right guard.
        const quill = buildEditor()
        const embed = insertEmbed(quill, 'legacyDeferred', 'g')
        expect(contentNodeOf(embed)).not.toBeNull()
        expect(embed.firstChild.data).toBe(GUARD)

        ReactDOM.render(React.createElement('b', { className: 'async' }, 'async render'), embed)

        expect(embed.querySelector('.async')).not.toBeNull()
        expect(contentNodeOf(embed)).toBeNull()
        expect(embed.textContent).not.toContain(GUARD)
    })

    it('an async first render through the mount node leaves the guards alone', () => {
        const quill = buildEditor()
        const embed = insertEmbed(quill, 'fixedDeferred', 'i')

        renderEmbedContent(embed, React.createElement('b', { className: 'async' }, 'async render'))

        const asyncNode = embed.querySelector('.async')
        expect(asyncNode).not.toBeNull()
        expect(contentNodeOf(embed)).not.toBeNull()
        // and it goes INSIDE the non-editable content node, not after the right guard.
        expect(contentNodeOf(embed).contains(asyncNode)).toBe(true)
        expect(embed.firstChild.data).toBe(GUARD)
        expect(embed.lastChild.data).toBe(GUARD)
        // The blot is still a normal single-character embed for quill.
        expect(quill.getLength()).toBe(15)
    })

    it('leaves the mount node out of layout', () => {
        const quill = buildEditor()
        const embed = insertEmbed(quill, 'fixedLate', 'h')

        expect(getEmbedReactRoot(embed).style.display).toBe('contents')
    })
})
