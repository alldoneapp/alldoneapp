/**
 * @jest-environment jsdom
 */
jest.mock('react-quill', () => ({
    Quill: {
        import: path => {
            if (path === 'core/module') return class MockModule {}
            if (path === 'delta') {
                return class MockDelta {
                    retain() {
                        return this
                    }
                    concat() {
                        return this
                    }
                    insert() {
                        return this
                    }
                    delete() {
                        return this
                    }
                }
            }
            if (path === 'parchment') return { Attributor: { Style: class {} }, Scope: { INLINE: 'INLINE' } }
            return class {}
        },
        events: {},
        sources: {},
    },
}))

jest.mock('../../textInputHelper', () => ({
    checkIfInputHaveKarma: jest.fn(),
    getPlaceholderData: jest.fn(),
    NEW_ATTACHMENT: '1',
    processPastedText: jest.fn(),
    QUILL_EDITOR_TEXT_INPUT_TYPE: '0',
}))

jest.mock('../../../../../redux/store', () => ({
    getState: () => ({ quillEditorProjectId: 'project-id' }),
}))

jest.mock('../../../Utils/HelperFunctions', () => ({
    tryToextractPeopleForMention: jest.fn(),
    REGEX_URL: /^https?:\/\/\S+$/i,
}))

jest.mock('../../../../NotesView/NotesDV/EditorView/mentionsHelper', () => ({
    loadQuill: jest.fn(),
}))

jest.mock('../../../../Premium/PremiumHelper', () => ({
    checkIsLimitedByTraffic: jest.fn(() => false),
}))

jest.mock('../../../../../utils/LinkingHelper', () => ({
    formatUrl: jest.fn(),
    getUrlObject: jest.fn(),
}))

import Autoformat from './autoformat'

describe('Autoformat link detection', () => {
    beforeEach(() => {
        Autoformat.DEFAULTS.link.find.lastIndex = 0
    })

    test('does not classify email addresses as links', () => {
        expect(Autoformat.DEFAULTS.link.find.test('karsten@alldone.app')).toBe(false)
    })

    test('still classifies regular domains as links', () => {
        expect(Autoformat.DEFAULTS.link.find.test('alldone.app')).toBe(true)
        Autoformat.DEFAULTS.link.find.lastIndex = 0
        expect(Autoformat.DEFAULTS.link.find.test('https://alldone.app')).toBe(true)
    })
})
