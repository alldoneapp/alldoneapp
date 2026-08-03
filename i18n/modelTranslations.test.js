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
        expect(translations['Use assistant model']).toBeTruthy()
        expect(translations['Use assistant effort']).toBeTruthy()
    })
})
