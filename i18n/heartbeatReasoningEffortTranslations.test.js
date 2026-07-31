const de = require('./translations/de.json')
const en = require('./translations/en.json')
const es = require('./translations/es.json')

describe('heartbeat reasoning effort translations', () => {
    const locales = { de, en, es }
    const requiredKeys = [
        'Heartbeat reasoning effort',
        'Choose how much reasoning heartbeat executions should use.',
        'Model default',
        'None',
        'Low',
        'Medium',
        'High',
        'XHigh',
        'Max',
    ]

    test.each(Object.entries(locales))('%s includes every heartbeat effort string', (locale, translations) => {
        requiredKeys.forEach(key => {
            expect(translations[key]).toBeTruthy()
        })
    })

    test('localizes the heartbeat-specific copy', () => {
        expect(de['Heartbeat reasoning effort']).toBe('Heartbeat-Denkaufwand')
        expect(es['Heartbeat reasoning effort']).toBe('Esfuerzo de razonamiento del heartbeat')
        expect(de['Choose how much reasoning heartbeat executions should use.']).toBe(
            'Wähle, wie viel Denkaufwand Heartbeat-Ausführungen verwenden sollen.'
        )
        expect(es['Choose how much reasoning heartbeat executions should use.']).toBe(
            'Elige cuánto razonamiento deben usar las ejecuciones de heartbeat.'
        )
    })
})
