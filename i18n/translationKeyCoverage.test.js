import fs from 'fs'
import path from 'path'

import en from './translations/en.json'

/**
 * Every translate('literal') in the app must have an entry in en.json.
 *
 * In this codebase the English source string is normally the key itself, so a missing entry
 * does NOT quietly fall back to English — TranslationService hands the key to i18n-js, which
 * renders the literal placeholder `[missing "en.<key>" translation]` straight into the UI.
 * That is what AT-2522 was reported for: the comment popup's loading, unavailable and
 * reconnecting states shipped with keys that existed in no locale file.
 *
 * de.json and es.json are deliberately NOT asserted here. TranslationService falls back to
 * the default locale, so a gap there renders correct English rather than a placeholder;
 * treating those as build failures would fail the suite on ~470 pre-existing gaps.
 *
 * Only single- and double-quoted literals are collected. Keys assembled from a template
 * literal are checked by dynamicTranslationKeys.test.js, which enumerates their variants.
 */

const ROOT = path.join(__dirname, '..')

const SEARCHED_DIRECTORIES = ['components', 'hooks', 'i18n', 'redux', 'URLSystem', 'utils']

// Cloud Functions ship their own strings and never import TranslationService.
const IGNORED_DIRECTORIES = new Set(['node_modules', '__snapshots__'])

const collectSourceFiles = directory => {
    const files = []
    const walk = current => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (IGNORED_DIRECTORIES.has(entry.name)) continue
            const target = path.join(current, entry.name)
            if (entry.isDirectory()) walk(target)
            else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(target)
        }
    }
    walk(directory)
    return files
}

// translate( 'key' | "key" ), tolerating the argument being wrapped onto its own line.
const TRANSLATE_CALL = /\btranslate\(\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1/g

const unescape = raw => raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\')

describe('translation key coverage (AT-2522)', () => {
    const usages = new Map()

    beforeAll(() => {
        SEARCHED_DIRECTORIES.forEach(directory => {
            collectSourceFiles(path.join(ROOT, directory)).forEach(file => {
                const source = fs.readFileSync(file, 'utf8')
                let match
                while ((match = TRANSLATE_CALL.exec(source)) !== null) {
                    const key = unescape(match[2])
                    if (!usages.has(key)) usages.set(key, new Set())
                    usages.get(key).add(path.relative(ROOT, file))
                }
            })
        })
    })

    it('finds the translate() call sites it is meant to guard', () => {
        // Guards the scanner itself: a regex or path change that silently matches nothing
        // would otherwise make the assertion below pass while checking nothing at all.
        expect(usages.size).toBeGreaterThan(1000)
        expect(usages.has('Comment')).toBe(true)
    })

    it('has an en.json entry for every statically referenced key', () => {
        const missing = [...usages.entries()]
            .filter(([key]) => !(key in en))
            .map(([key, files]) => `${JSON.stringify(key)} used in ${[...files].join(', ')}`)
            .sort()

        expect(missing).toEqual([])
    })

    it('resolves the comment popup states that regressed', () => {
        // The exact strings the popup renders while it is still loading an object.
        ;['task', 'goal', 'note', 'contact', 'chat', 'skill', 'assistant', 'object'].forEach(slug => {
            expect(en[`comment_popup_loading_${slug}`]).toBeTruthy()
            expect(en[`comment_popup_unavailable_text_${slug}`]).toBeTruthy()
            expect(en[`comment_popup_reconnecting_text_${slug}`]).toBeTruthy()
        })
    })

    it('no longer carries the keys a find/replace truncated', () => {
        expect(en['cus to projects sidebar on the left']).toBeUndefined()
        expect(en['cus to elements on the right excluding the sidebar']).toBeUndefined()
        expect(en['Focus to projects sidebar on the left']).toBe('Focus to projects sidebar on the left.')
        expect(en['Focus to elements on the right excluding the sidebar']).toBe(
            'Focus to elements on the right excluding the sidebar.'
        )
    })
})
