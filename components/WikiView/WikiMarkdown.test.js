import React from 'react'
import { StyleSheet, Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import WikiMarkdown, { getWikiSourceLabel } from './WikiMarkdown'

jest.mock('../Icon', () => ({ __esModule: true, default: () => null, getIconGlyph: name => `<${name}>` }))
jest.mock('../../i18n/TranslationService', () => {
    const en = require('../../i18n/translations/en.json')
    return { translate: key => (en[key] !== undefined ? en[key] : key) }
})

function textOf(node) {
    if (typeof node === 'string') return node
    if (!node || !node.children) return ''
    return node.children.map(textOf).join('')
}

function render(props) {
    let component
    act(() => {
        component = renderer.create(<WikiMarkdown {...props} />)
    })
    return component
}

const BODY = [
    '## Kunden',
    '',
    'Acme ist Pilotkunde [[task:t1]], siehe [[entscheidungen|Entscheidungen]] und [[alt-seite]].',
    '',
    '- Beta [[contact:c1]]',
    '- Korrigiert [[correction:k1]]',
].join('\n')

describe('WikiMarkdown', () => {
    it('renders the page text with its sources named by the labels stored on the page', () => {
        const component = render({
            body: BODY,
            sourceLabels: { 'task:t1': 'Acme Pilot gewinnen' },
            pageExists: slug => slug === 'entscheidungen',
        })
        const text = textOf(component.toJSON())

        expect(text).toContain('Kunden')
        expect(text).toContain('Acme ist Pilotkunde')
        expect(text).toContain('<check-square> Acme Pilot gewinnen')
        // No stored label: the object type names it rather than a bare id.
        expect(text).toContain('<user> Contact')
        expect(text).not.toContain('[[')
        expect(text).not.toContain('task:t1')
    })

    it('opens a linked page that exists and leaves a link to a missing page inert', () => {
        const onPressPage = jest.fn()
        const component = render({ body: BODY, pageExists: slug => slug === 'entscheidungen', onPressPage })

        const existing = component.root.findByProps({ testID: 'wiki-page-link-entscheidungen' })
        const missing = component.root.findByProps({ testID: 'wiki-page-link-alt-seite' })
        expect(textOf(existing)).toBe('Entscheidungen')
        expect(missing.props.onPress).toBeUndefined()

        act(() => existing.props.onPress())
        expect(onPressPage).toHaveBeenCalledWith('entscheidungen')
    })

    it('opens the object a source cites, but not a correction, which has no view', () => {
        const onPressSource = jest.fn()
        const component = render({ body: BODY, onPressSource })

        act(() => component.root.findByProps({ testID: 'wiki-source-task:t1' }).props.onPress())
        expect(onPressSource).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'task', id: 't1' }))
        expect(component.root.findByProps({ testID: 'wiki-source-correction:k1' }).props.onPress).toBeUndefined()
    })

    it('shows a document added to the wiki by its title, as a source that cannot be opened', () => {
        const onPressSource = jest.fn()
        const component = render({
            body: 'Team kostet 12 € [[document:d1]], Business 24 € [[document:d2]].',
            sourceLabels: { 'document:d1': 'Pricing concept 2026' },
            onPressSource,
        })
        const text = textOf(component.toJSON())

        expect(text).toContain('<paperclip> Pricing concept 2026')
        expect(text).toContain('<paperclip> Document')
        expect(text).not.toContain('[[')
        expect(component.root.findByProps({ testID: 'wiki-source-document:d1' }).props.onPress).toBeUndefined()
    })

    it('shows conversations and artifacts as sources that open where they live', () => {
        const onPressSource = jest.fn()
        const component = render({
            body: 'Release am 3. November [[chat:t1]], Zahlen im Dashboard [[artifact:a1]] [[chat:topic]].',
            sourceLabels: { 'chat:t1': 'Release planen', 'artifact:a1': 'Churn-Dashboard' },
            onPressSource,
        })
        const text = textOf(component.toJSON())

        expect(text).toContain('<message-circle> Release planen')
        expect(text).toContain('<package> Churn-Dashboard')
        expect(text).toContain('<message-circle> Chat')
        act(() => component.root.findByProps({ testID: 'wiki-source-chat:t1' }).props.onPress())
        act(() => component.root.findByProps({ testID: 'wiki-source-artifact:a1' }).props.onPress())
        expect(onPressSource.mock.calls.map(([node]) => node.key)).toEqual(['chat:t1', 'artifact:a1'])
    })

    it('renders no markup it was not written for', () => {
        const component = render({ body: '<img src=x onerror=alert(1)> **fett** [Link](javascript:alert(1))' })
        const texts = component.root.findAllByType(Text)

        expect(textOf(component.toJSON())).toContain('<img src=x onerror=alert(1)>')
        // The javascript: link is shown as text, not made pressable.
        expect(texts.filter(node => typeof node.props.onPress === 'function')).toHaveLength(0)
    })

    // AT-2873. Layout itself is only observable in a real browser (browser-tests/at2873); this pins
    // the style contract it depends on, which the app shell's `* { flex-basis: auto !important }`
    // reset otherwise breaks without any error.
    it('starts lists on the content edge: a fixed marker column, hanging text, nested lists under their parent text', () => {
        const body = ['- Eins', '  - Zwei', '', ...Array.from({ length: 10 }, (_, i) => `${i + 1}. Punkt ${i + 1}`)]
        const component = render({ body: body.join('\n') })
        const styleOf = node => StyleSheet.flatten(node.props.style)
        const markers = component.root.findAll(node => node.props.testID === 'wiki-list-marker' && node.type === Text)
        const texts = component.root.findAll(node => node.props.testID === 'wiki-list-text' && node.type === Text)
        const lists = component.root.findAll(
            node => node.props.testID === 'wiki-list' && typeof node.type !== 'string',
            {
                deep: true,
            }
        )

        expect(markers.map(node => textOf(node))).toEqual([
            '•',
            '•',
            ...Array.from({ length: 10 }, (_, i) => `${i + 1}.`),
        ])
        // Never squeezed by a long item, so every item's text starts at the same indent...
        for (const marker of markers) expect(styleOf(marker).flexShrink).toBe(0)
        // ...and the text column may shrink instead, wrapping under its own first line.
        for (const text of texts) expect(styleOf(text)).toEqual(expect.objectContaining({ flex: 1, minWidth: 0 }))

        // A bullet starts at the left of its 20px column, i.e. on the content edge — no whole-list
        // inset like the notes editor's (the AT-2873 follow-up).
        const bullet = styleOf(markers[0])
        expect(bullet).toEqual(expect.objectContaining({ minWidth: 20, textAlign: 'left' }))
        expect(bullet.paddingLeft || 0).toBe(0)
        // Numbers are right-aligned in a column one digit wider for a list that reaches "10.".
        expect(styleOf(markers[2])).toEqual(
            expect.objectContaining({ minWidth: 29, textAlign: 'right', paddingRight: 6 })
        )

        const [topLevel, nested, ordered] = lists.map(styleOf)
        expect(topLevel.marginLeft || 0).toBe(0)
        expect(ordered.marginLeft || 0).toBe(0)
        // The nested list starts under its parent's text.
        expect(nested.marginLeft).toBe(20)
    })

    it('labels a source by its type when nothing better is known', () => {
        expect(getWikiSourceLabel({ key: 'note:n1', objectType: 'note' })).toBe('Note')
        expect(getWikiSourceLabel({ key: 'note:n1', objectType: 'note', label: 'Eigenes Label' })).toBe('Eigenes Label')
        expect(getWikiSourceLabel({ key: 'note:n1', objectType: 'note' }, { 'note:n1': 'Protokoll' })).toBe('Protokoll')
    })
})
