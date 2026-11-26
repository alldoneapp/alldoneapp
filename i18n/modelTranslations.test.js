const en = require('./translations/en.json')
const de = require('./translations/de.json')
const es = require('./translations/es.json')

describe('assistant model translations', () => {
    test.each([
        ['en', en],
        ['de', de],
        ['es', es],
    ])('%s includes every Sol family model and the inheritance option', (language, translations) => {
        expect(translations['GPT 5_6 Sol']).toBeTruthy()
        expect(translations['GPT 5_6 Terra']).toBeTruthy()
        expect(translations['GPT 5_6 Luna']).toBeTruthy()
        // The current menu (AT-3163); the older keys stay for Updates entries written before it.
        expect(translations['GPT 6.2 Sol']).toBe('GPT 6.2 Sol')
        expect(translations['GPT 6.1 Terra']).toBe('GPT 6.1 Terra')
        expect(translations['GPT 6 Luna']).toBe('GPT 6 Luna')
        expect(translations['DeepSeek V4.1 Flash']).toBe('DeepSeek V4.1 Flash')
        expect(translations['Use assistant model']).toBeTruthy()
        // The thread picker's inherit entry (AT-2512). The placeholder has to survive translation,
        // or the label renders the assistant's model name nowhere at all.
        expect(translations['Use assistant model with name']).toContain('%{name}')
        expect(translations['Use assistant effort']).toBeTruthy()
        expect(translations['Assistant email']).toBeTruthy()
        expect(translations['Inbound email model']).toBeTruthy()
        expect(translations['Choose the model used to process messages sent to Anna by email.']).toBeTruthy()
        expect(translations['Inherit assistant model']).toBeTruthy()
        expect(translations['Use the normal assistant model for inbound email.']).toBeTruthy()
    })
})
