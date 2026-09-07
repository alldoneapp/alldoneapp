import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TextInput } from 'react-native'

const mockSave = jest.fn(() => Promise.resolve())

jest.mock('../../../../utils/backends/Projects/projectsFirestore', () => ({
    setProjectBrowserAutomation: (...args) => mockSave(...args),
}))

// The modal pulls in Button -> ... -> utils/SharedHelper, which calls getDeviceLanguage at module
// scope, so the mock has to answer that too.
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: key => key,
    getDeviceLanguage: () => 'en',
    getLanguage: () => 'en',
}))

jest.mock('../../../UIControls/CustomScrollView', () => 'CustomScrollView')

const BrowserAllowlistModal = require('./BrowserAllowlistModal').default

function render(browserAutomation) {
    let tree
    act(() => {
        tree = renderer.create(
            <BrowserAllowlistModal projectId="p1" browserAutomation={browserAutomation} closeModal={() => {}} />
        )
    })
    return tree
}

function textsOf(tree) {
    return tree.root
        .findAllByType(Text)
        .map(node => (typeof node.props.children === 'string' ? node.props.children : ''))
        .filter(Boolean)
}

function type(tree, value) {
    act(() => {
        tree.root.findAllByType(TextInput)[0].props.onChangeText(value)
    })
}

function submit(tree) {
    act(() => {
        tree.root.findAllByType(TextInput)[0].props.onSubmitEditing()
    })
}

function pressSave(tree) {
    const saveButton = tree.root.findAll(node => node.props && node.props.title === 'Save')[0]
    return act(async () => {
        await saveButton.props.onPress()
    })
}

describe('BrowserAllowlistModal', () => {
    beforeEach(() => mockSave.mockClear())

    it('says an empty list means browsing is off, rather than showing a blank box', () => {
        // Default deny: an empty allowlist is not "everything", and the empty state has to say so or
        // it reads like a feature that has not loaded.
        const tree = render({ allowedDomains: [] })
        expect(textsOf(tree)).toContain('browser_allowlist_empty')
    })

    it('adds a valid entry in its normalized form', () => {
        const tree = render({ allowedDomains: [] })
        type(tree, 'https://www.eventim.de/city/berlin/')
        submit(tree)
        expect(textsOf(tree)).toContain('www.eventim.de/city/berlin')
    })

    it('names the specific problem instead of silently dropping the entry', () => {
        // The server drops an unusable entry on read; without a message here that looks exactly like
        // the allowlist being ignored.
        const cases = [
            ['192.168.1.5', 'browser_allowlist_error_private'],
            ['*', 'browser_allowlist_error_wildcard'],
            ['intranet', 'browser_allowlist_error_tld'],
            ['ftp://example.com', 'browser_allowlist_error_scheme'],
        ]
        for (const [entry, errorKey] of cases) {
            const tree = render({ allowedDomains: [] })
            type(tree, entry)
            submit(tree)
            expect(textsOf(tree)).toContain(errorKey)
            expect(textsOf(tree)).toContain('browser_allowlist_empty')
        }
    })

    it('refuses a duplicate of something already allowed', () => {
        const tree = render({ allowedDomains: ['example.com'] })
        type(tree, 'https://Example.com/')
        submit(tree)
        expect(textsOf(tree)).toContain('browser_allowlist_error_duplicate')
    })

    it('keeps the good hosts of a paste and reports the bad one', () => {
        const tree = render({ allowedDomains: [] })
        type(tree, 'eventim.de, 10.0.0.1, kulturhaus.example')
        submit(tree)
        const texts = textsOf(tree)
        expect(texts).toContain('eventim.de')
        expect(texts).toContain('kulturhaus.example')
        expect(texts).toContain('browser_allowlist_error_private')
    })

    it('saves the whole configuration, so removing the last entry actually removes it', async () => {
        const tree = render({ allowedDomains: ['eventim.de'], enabled: true, allowSearchSubmit: true })
        type(tree, 'kulturhaus.example')
        submit(tree)
        await pressSave(tree)

        expect(mockSave).toHaveBeenCalledWith('p1', {
            enabled: true,
            allowedDomains: ['eventim.de', 'kulturhaus.example'],
            allowSearchSubmit: true,
            limits: {},
        })
    })

    it('drops a stored entry that is no longer valid rather than showing it as allowed', () => {
        // The list is client-written, so an old or hand-edited document can hold anything. What is
        // shown has to be what the server would actually honour.
        const tree = render({ allowedDomains: ['eventim.de', '127.0.0.1', '*'] })
        const texts = textsOf(tree)
        expect(texts).toContain('eventim.de')
        expect(texts).not.toContain('127.0.0.1')
        expect(texts).not.toContain('*')
    })
})
