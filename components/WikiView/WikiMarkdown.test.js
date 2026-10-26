import React from 'react'
import { Text } from 'react-native'
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

    it('labels a source by its type when nothing better is known', () => {
        expect(getWikiSourceLabel({ key: 'note:n1', objectType: 'note' })).toBe('Note')
        expect(getWikiSourceLabel({ key: 'note:n1', objectType: 'note', label: 'Eigenes Label' })).toBe('Eigenes Label')
        expect(getWikiSourceLabel({ key: 'note:n1', objectType: 'note' }, { 'note:n1': 'Protokoll' })).toBe('Protokoll')
    })
})
