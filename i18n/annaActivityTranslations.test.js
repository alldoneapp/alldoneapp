import fs from 'fs'
import path from 'path'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { setLanguage } from './TranslationService'
import { formatAnnaActivityText } from '../components/Anna/annaActivityText'
import de from './translations/de.json'
import en from './translations/en.json'
import es from './translations/es.json'

const locales = { en, de, es }
const root = path.join(__dirname, '..')
const producerFiles = directory =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name)
        return entry.isDirectory()
            ? producerFiles(file)
            : entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')
              ? [file]
              : []
    })

// Feed text comes from stored events, so the ordinary translate('literal')
// scan cannot see it. Check the fixed phrases in both client/server producers.
const fixedFeedPhrases = () => {
    const phrases = new Set()
    const collect = node => {
        if (node?.type === 'StringLiteral' && node.value) phrases.add(node.value)
        if (node?.type === 'TemplateLiteral' && !node.expressions.length) phrases.add(node.quasis[0].value.cooked)
        if (node?.type === 'ConditionalExpression') {
            collect(node.consequent)
            collect(node.alternate)
        }
        if (node?.type === 'LogicalExpression') {
            collect(node.left)
            collect(node.right)
        }
    }
    for (const folder of ['utils/backends', 'functions/Feeds']) {
        for (const file of producerFiles(path.join(root, folder))) {
            const source = fs.readFileSync(file, 'utf8')
            if (!source.includes('entryText:')) continue
            traverse(parse(source, { sourceType: 'unambiguous', plugins: ['jsx'] }), {
                ObjectProperty({ node }) {
                    if (node.key.name === 'entryText') collect(node.value)
                },
            })
        }
    }
    return [...phrases]
}

afterEach(() => setLanguage('en'))

it('translates the three German activity notices from the reported screenshot', () => {
    setLanguage('de')
    expect(formatAnnaActivityText('changed task to Open')).toBe('Aufgabe auf „Offen“ gesetzt')
    expect(formatAnnaActivityText('created task')).toBe('Aufgabe erstellt')
    expect(formatAnnaActivityText('started following the task')).toBe('Folgt jetzt der Aufgabe')
})

it.each(Object.entries(locales))('covers fixed persisted feed descriptions in %s', (language, translations) => {
    const phrases = fixedFeedPhrases()
    expect(phrases.length).toBeGreaterThan(40)
    expect(phrases.filter(phrase => !translations[phrase])).toEqual([])
    setLanguage(language)
    phrases.forEach(phrase => expect(formatAnnaActivityText(phrase)).not.toMatch(/\[missing/))
})

it.each(Object.keys(locales))('preserves generated and custom text without translation diagnostics in %s', language => {
    setLanguage(language)
    for (const phrase of [
        'changed description • From Original text to A new description',
        'Imported note from https://example.com/new.note',
        'Custom text containing %{provider} and %{user}',
    ])
        expect(formatAnnaActivityText(phrase)).toBe(phrase)
    expect(formatAnnaActivityText(undefined)).toBe('')
})
