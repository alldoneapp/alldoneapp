import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TextInput, TouchableOpacity } from 'react-native'
import Switch from '../../../UIControls/Switch'

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

function pressMode(tree, label) {
    const row = tree.root.findAll(node => node.props && node.props.accessibilityLabel === label)[0]
    if (!row) throw new Error(`No mode row labelled ${label}`)
    act(() => {
        row.props.onPress()
    })
}

/**
 * Press the real `Switch`. The production defect was invisible to every test here because none of
 * them ever pressed it: the modal handed the switch React Native's `value`/`onValueChange` while
 * this repo's Switch takes `active`/`activeSwitch`/`deactiveSwitch`, so the press called `undefined`
 * and threw `TypeError: t is not a function` out of PressResponder (AT-2518).
 */
function pressSearchFormsSwitch(tree) {
    const switchRow = tree.root.findAllByType(Switch)[0]
    if (!switchRow) throw new Error('No Switch rendered')
    const touchable = switchRow.findAllByType(TouchableOpacity)[0]
    act(() => {
        touchable.props.onPress()
    })
    return switchRow
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
            accessMode: 'selected',
            allowedDomains: ['eventim.de', 'kulturhaus.example'],
            deniedDomains: [],
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

describe('BrowserAllowlistModal access modes', () => {
    beforeEach(() => mockSave.mockClear())

    it('defaults to "only selected websites", whatever the stored value is', () => {
        // The default is not a preference, it is the fail-closed direction — the same rule the
        // server applies to the same field.
        for (const accessMode of [undefined, 'selected', 'ALL_PUBLIC', 'everything']) {
            const tree = render({ allowedDomains: ['eventim.de'], accessMode })
            expect(textsOf(tree)).not.toContain('browser_mode_all_public_warning')
        }
    })

    it('shows the security warning only when all public websites are chosen', () => {
        const tree = render({ allowedDomains: [] })
        expect(textsOf(tree)).not.toContain('browser_mode_all_public_warning')

        pressMode(tree, 'browser_mode_all_public')
        const texts = textsOf(tree)
        expect(texts).toContain('browser_mode_all_public_warning')
        // And says what did NOT change, because "all websites" invites the reading that the safety
        // rules went with the list.
        expect(texts).toContain('browser_mode_all_public_still_blocked')
    })

    it('stops calling an empty allowlist "browsing is off" once it is no longer the gate', () => {
        const tree = render({ allowedDomains: [] })
        expect(textsOf(tree)).toContain('browser_allowlist_empty')

        pressMode(tree, 'browser_mode_all_public')
        const texts = textsOf(tree)
        expect(texts).toContain('browser_allowlist_unused_in_all_public')
        expect(texts).not.toContain('browser_allowlist_empty')
    })

    it('saves the chosen mode', async () => {
        const tree = render({ allowedDomains: ['eventim.de'] })
        pressMode(tree, 'browser_mode_all_public')
        await pressSave(tree)

        expect(mockSave).toHaveBeenCalledWith('p1', {
            enabled: true,
            accessMode: 'all_public',
            // Kept rather than cleared: switching back to "only selected" must not silently have
            // thrown the list away.
            allowedDomains: ['eventim.de'],
            deniedDomains: [],
            allowSearchSubmit: true,
            limits: {},
        })
    })

    it('turns browsing off without losing the mode the user had chosen', async () => {
        const tree = render({ allowedDomains: ['eventim.de'], accessMode: 'all_public' })
        pressMode(tree, 'browser_mode_off')
        await pressSave(tree)

        expect(mockSave).toHaveBeenCalledWith(
            'p1',
            expect.objectContaining({ enabled: false, accessMode: 'all_public' })
        )
    })

    it('edits the blocked list with the same validation as the allowed one', async () => {
        const tree = render({ allowedDomains: [], accessMode: 'all_public' })
        const inputs = () => tree.root.findAllByType(TextInput)

        act(() => {
            inputs()[1].props.onChangeText('ads.example, 10.0.0.1')
        })
        act(() => {
            inputs()[1].props.onSubmitEditing()
        })

        const texts = textsOf(tree)
        expect(texts).toContain('ads.example')
        expect(texts).toContain('browser_allowlist_error_private')

        await pressSave(tree)
        expect(mockSave).toHaveBeenCalledWith('p1', expect.objectContaining({ deniedDomains: ['ads.example'] }))
    })

    it('drops a stored blocked entry that is no longer valid', () => {
        const tree = render({ allowedDomains: [], deniedDomains: ['ads.example', '127.0.0.1'] })
        const texts = textsOf(tree)
        expect(texts).toContain('ads.example')
        expect(texts).not.toContain('127.0.0.1')
    })
})

describe('BrowserAllowlistModal — AT-2518 production regression', () => {
    beforeEach(() => mockSave.mockClear())

    it('turns the search-forms switch on instead of throwing out of the press handler', () => {
        // The reported symptom, in both halves: the toggle never moved, and every press threw.
        const tree = render({ allowedDomains: ['eventim.de'], allowSearchSubmit: false })
        // It starts off, as stored...
        expect(tree.root.findAllByType(Switch)[0].props.active).toBe(false)

        // ...the press does not throw...
        expect(() => pressSearchFormsSwitch(tree)).not.toThrow()

        // ...and it actually moved, which is the half the user could see.
        expect(tree.root.findAllByType(Switch)[0].props.active).toBe(true)
    })

    it('hands the switch the props this repo really uses', () => {
        const tree = render({ allowedDomains: [] })
        const switchProps = tree.root.findAllByType(Switch)[0].props

        expect(typeof switchProps.activeSwitch).toBe('function')
        expect(typeof switchProps.deactiveSwitch).toBe('function')
        // `value`/`onValueChange` are React Native core names and mean nothing to this component.
        expect(switchProps.value).toBeUndefined()
        expect(switchProps.onValueChange).toBeUndefined()
    })

    it('persists the toggled search-forms setting', async () => {
        const tree = render({ allowedDomains: ['eventim.de'], allowSearchSubmit: true })
        pressSearchFormsSwitch(tree)
        await pressSave(tree)

        expect(mockSave).toHaveBeenCalledWith('p1', expect.objectContaining({ allowSearchSubmit: false }))
    })

    it('saves all_public with an empty allowlist — the exact case that was reported', async () => {
        const tree = render({ allowedDomains: [], deniedDomains: [] })
        pressMode(tree, 'browser_mode_all_public')
        await pressSave(tree)

        expect(mockSave).toHaveBeenCalledWith('p1', {
            enabled: true,
            accessMode: 'all_public',
            allowedDomains: [],
            deniedDomains: [],
            allowSearchSubmit: true,
            limits: {},
        })
        // Nothing in the payload may be undefined: Firestore rejects the whole write for one.
        for (const value of Object.values(mockSave.mock.calls[0][1])) expect(value).toBeDefined()
    })

    it('says WHY a save failed instead of a sentence that names nothing', async () => {
        // The last report needed a production bundle dump to learn the answer was one word.
        const error = new Error('Missing or insufficient permissions.')
        error.code = 'permission-denied'
        mockSave.mockImplementationOnce(() => Promise.reject(error))

        const tree = render({ allowedDomains: ['eventim.de'] })
        await pressSave(tree)

        expect(textsOf(tree).some(text => text.includes('permission-denied'))).toBe(true)
    })

    it('refuses to write when there is no project behind the editor, and says so', async () => {
        // The global assistant editor: `projectId` there is the global project, which holds no
        // workspace configuration and refuses every write.
        let tree
        act(() => {
            tree = renderer.create(
                <BrowserAllowlistModal
                    projectId="globalProject"
                    browserAutomation={{}}
                    canConfigure={false}
                    closeModal={() => {}}
                />
            )
        })
        expect(textsOf(tree)).toContain('browser_allowlist_no_project')

        await pressSave(tree)
        expect(mockSave).not.toHaveBeenCalled()
    })

    it('does not report a successful save as failed when closeModal is absent', async () => {
        let tree
        act(() => {
            tree = renderer.create(<BrowserAllowlistModal projectId="p1" browserAutomation={{}} />)
        })
        await pressSave(tree)

        expect(mockSave).toHaveBeenCalled()
        expect(textsOf(tree)).not.toContain('browser_allowlist_save_failed')
    })
})
