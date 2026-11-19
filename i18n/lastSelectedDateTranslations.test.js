import i18n from 'i18n-js'

import { setLanguage, translate } from './TranslationService'
import de from './translations/de.json'
import en from './translations/en.json'
import es from './translations/es.json'

// AT-3108: the "Last selected" option of the "Select reminder" date dialog
// showed Dutch ("Laatst geselecteerd") in the German locale.
describe('reminder date dialog "Last selected" option (AT-3108)', () => {
    let originalLocale

    beforeEach(() => {
        originalLocale = i18n.locale
    })

    afterEach(() => {
        setLanguage(originalLocale)
    })

    it.each([
        ['de', 'Select reminder', 'Erinnerungsdatum auswählen'],
        ['de', 'Last selected', 'Zuletzt ausgewählt'],
        ['en', 'Last selected', 'Last selected'],
        ['es', 'Last selected', 'Última selección'],
    ])('%s resolves %s to %s', (locale, key, expected) => {
        setLanguage(locale)
        expect(translate(key)).toBe(expected)
    })

    it('keeps the German translation free of the Dutch string', () => {
        expect(de['Last selected']).toBe('Zuletzt ausgewählt')
        expect(JSON.stringify(de)).not.toMatch(/geselecteerd/i)
        expect(en['Last selected']).toBeDefined()
        expect(es['Last selected']).toBeDefined()
    })
})
