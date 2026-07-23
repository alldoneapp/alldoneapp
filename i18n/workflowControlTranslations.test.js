import de from './translations/de.json'
import en from './translations/en.json'
import es from './translations/es.json'

describe('workflow control translations', () => {
    const locales = { de, en, es }
    const requiredKeys = [
        'Current',
        'Current workflow step with name',
        'Select workflow step with name',
        'Send back',
        'Send forward',
    ]

    it.each(Object.entries(locales))('%s contains every workflow control string', (locale, translations) => {
        requiredKeys.forEach(key => {
            expect(translations[key]).toBeTruthy()
        })
        expect(translations['Current workflow step with name']).toContain('%{step}')
        expect(translations['Select workflow step with name']).toContain('%{step}')
    })

    it('uses concise, natural directional action labels', () => {
        expect(de['Send back']).toBe('Zurückschicken')
        expect(de['Send forward']).toBe('Weiterschicken')
        expect(en['Send back']).toBe('Send back')
        expect(en['Send forward']).toBe('Send forward')
        expect(es['Send back']).toBe('Retroceder')
        expect(es['Send forward']).toBe('Avanzar')
    })
})
