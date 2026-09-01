/**
 * @jest-environment jsdom
 *
 * The other half of AT-2454's mount node: taking it down again.
 *
 * Nothing ever did. `renderEmbedContent` mounts a React root per embed and quill 2 offers a blot
 * exactly one teardown hook (`detach()`) which no format implemented — so every `setContents`,
 * every note reopened, every copy through `onCopy`'s throwaway editor orphaned one root per tag,
 * each still subscribed to redux (and, for a task tag, to a Firestore listener).
 *
 * These drive a REAL quill 2 with REAL `ReactDOM.render` roots, because the whole question is
 * when parchment calls `detach()` and whether the node is genuinely gone by then — a quill double
 * decides that by fiat and would prove nothing.
 */
import React from 'react'
import Quill from 'quill'

import { EMBED_REACT_ROOT_CLASS, getEmbedReactRoot, renderEmbedContent, unmountEmbedReactRoots } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

// Every unmount in this module is deferred to a microtask (see scheduleEmbedContentUnmount).
const flushUnmounts = () => Promise.resolve().then(() => {})

const mounted = new Set()

// A class on purpose: legacy `ReactDOM.render` runs class lifecycle synchronously, while a
// passive effect is only scheduled — a `useEffect` here would make every assertion a race
// against React's scheduler rather than a statement about when the root is torn down.
class Tracked extends React.Component {
    componentDidMount() {
        mounted.add(this.props.id)
    }
    componentWillUnmount() {
        mounted.delete(this.props.id)
    }
    render() {
        return React.createElement('span', { className: 'tracked' }, this.props.id)
    }
}

class TrackedEmbed extends ReactEmbedBlot {
    static create(data) {
        const node = super.create('tracked')
        node.setAttribute('data-id', data.id)
        node.setAttribute('contenteditable', false)
        renderEmbedContent(node, React.createElement(Tracked, { id: data.id }))
        return node
    }
    static value(domNode) {
        return { id: domNode.getAttribute('data-id') }
    }
}
TrackedEmbed.blotName = 'trackedEmbed'
TrackedEmbed.className = 'ql-trackedEmbed'
TrackedEmbed.tagName = 'span'

// The unfixed shape: identical, minus the detach hook.
class LegacyEmbed extends Quill.import('blots/embed') {
    static create(data) {
        const node = super.create('legacy')
        node.setAttribute('data-id', data.id)
        node.setAttribute('contenteditable', false)
        renderEmbedContent(node, React.createElement(Tracked, { id: data.id }))
        return node
    }
    static value(domNode) {
        return { id: domNode.getAttribute('data-id') }
    }
}
LegacyEmbed.blotName = 'legacyEmbed'
LegacyEmbed.className = 'ql-legacyEmbed'
LegacyEmbed.tagName = 'span'

Quill.register(TrackedEmbed, true)
Quill.register(LegacyEmbed, true)

const buildEditor = () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    return new Quill(host)
}

const insert = (quill, blotName, ids) =>
    quill.setContents([
        { insert: 'before ' },
        ...ids.map(id => ({ insert: { [blotName]: { id } } })),
        { insert: ' after\n' },
    ])

describe('a React root inside a quill 2 embed is torn down with its blot', () => {
    afterEach(() => {
        document.body.innerHTML = ''
        mounted.clear()
    })

    it('unmounts the root when the embed is deleted from the document', async () => {
        const quill = buildEditor()
        insert(quill, 'trackedEmbed', ['a'])
        expect(mounted.has('a')).toBe(true)

        quill.setContents([{ insert: 'replaced\n' }])
        await flushUnmounts()

        expect(mounted.has('a')).toBe(false)
    })

    it('reproduces the leak without the detach hook', async () => {
        const quill = buildEditor()
        insert(quill, 'legacyEmbed', ['b'])
        expect(mounted.has('b')).toBe(true)

        quill.setContents([{ insert: 'replaced\n' }])
        await flushUnmounts()

        // Still mounted, still subscribed, with no way left to reach it.
        expect(mounted.has('b')).toBe(true)
    })

    it('unmounts every embed of a replaced document, not just the first', async () => {
        const quill = buildEditor()
        insert(quill, 'trackedEmbed', ['c', 'd', 'e'])
        expect(mounted.size).toBe(3)

        quill.setContents([{ insert: 'replaced\n' }])
        await flushUnmounts()

        expect(mounted.size).toBe(0)
    })

    it('leaves an embed that is still in the editor alone', async () => {
        const quill = buildEditor()
        insert(quill, 'trackedEmbed', ['f', 'g'])

        // Delete only the first embed; the second one merely shifts.
        quill.deleteText(7, 1)
        await flushUnmounts()

        expect(mounted.has('f')).toBe(false)
        expect(mounted.has('g')).toBe(true)
    })

    it('refuses to render into a root that has already been torn down', async () => {
        const quill = buildEditor()
        insert(quill, 'trackedEmbed', ['h'])
        const embed = quill.root.querySelector('span.ql-trackedEmbed')
        const mountNode = getEmbedReactRoot(embed)

        quill.setContents([{ insert: 'replaced\n' }])
        await flushUnmounts()

        // url.js renders from a Backend callback that routinely lands after the embed is gone.
        expect(renderEmbedContent(embed, React.createElement(Tracked, { id: 'h' }))).toBeNull()
        expect(mounted.has('h')).toBe(false)
        expect(mountNode.childNodes).toHaveLength(0)
    })
})

describe('unmountEmbedReactRoots', () => {
    afterEach(() => {
        document.body.innerHTML = ''
        mounted.clear()
    })

    it('takes down every root under an editor quill will never say goodbye to', async () => {
        const quill = buildEditor()
        insert(quill, 'trackedEmbed', ['i', 'j'])
        expect(mounted.size).toBe(2)

        // What leaving a note / discarding onCopy's throwaway editor looks like: the whole
        // editor is dropped and not one blot is detached.
        unmountEmbedReactRoots(quill.root)
        await flushUnmounts()

        expect(mounted.size).toBe(0)
        expect(quill.root.querySelectorAll(`.${EMBED_REACT_ROOT_CLASS}`).length).toBe(2)
    })

    it('is a no-op for a missing root rather than a throw', async () => {
        expect(() => unmountEmbedReactRoots(undefined)).not.toThrow()
        expect(() => unmountEmbedReactRoots(null)).not.toThrow()
    })

    it('does not double-unmount a root a detached blot already claimed', async () => {
        const quill = buildEditor()
        insert(quill, 'trackedEmbed', ['k'])
        const root = quill.root

        quill.setContents([{ insert: 'replaced\n' }])
        unmountEmbedReactRoots(root)
        await flushUnmounts()

        expect(mounted.size).toBe(0)
    })
})
