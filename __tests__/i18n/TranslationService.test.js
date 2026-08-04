jest.mock('../../utils/WebShims/Localization', () => ({
    locale: 'en-US',
}))

import { setLanguage, translate } from '../../i18n/TranslationService'

describe('TranslationService', () => {
    beforeEach(() => {
        setLanguage('en')
    })

    test('returns exact translations for flat keys ending with punctuation', () => {
        expect(translate('There are no visible comments to show right now.')).toBe(
            'There are no visible comments to show right now.'
        )
    })

    test('keeps regular translation lookups working', () => {
        expect(translate('No comments yet')).toBe('No comments yet')
    })
})
