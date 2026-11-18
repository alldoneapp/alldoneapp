// AT-3082: the fixed lines of Anna's task notices are in the recipient's app language.

jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => ({ doc: jest.fn() })) }))

const {
    NOTICE_LANGUAGES,
    NOTICE_STRINGS,
    buildNoticeTaskLabel,
    loadNoticeLanguage,
    noticeStepLabel,
    noticeText,
    normalizeNoticeLanguage,
    quoteNotice,
} = require('./noticeLanguage')

const placeholders = template => [...template.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort()

describe('the string table', () => {
    test('every language has every English key with the same placeholders', () => {
        for (const language of NOTICE_LANGUAGES) {
            for (const [key, english] of Object.entries(NOTICE_STRINGS.en)) {
                expect([language, key, typeof NOTICE_STRINGS[language][key]]).toEqual([language, key, 'string'])
                expect([language, key, placeholders(NOTICE_STRINGS[language][key])]).toEqual([
                    language,
                    key,
                    placeholders(english),
                ])
            }
            expect(Object.keys(NOTICE_STRINGS[language]).sort()).toEqual(Object.keys(NOTICE_STRINGS.en).sort())
        }
    })
})

describe('normalizeNoticeLanguage', () => {
    test('takes the base language of a supported code, English otherwise', () => {
        expect(normalizeNoticeLanguage('de')).toBe('de')
        expect(normalizeNoticeLanguage('de-DE')).toBe('de')
        expect(normalizeNoticeLanguage(' ES ')).toBe('es')
        expect(normalizeNoticeLanguage('fr')).toBe('en')
        expect(normalizeNoticeLanguage('')).toBe('en')
        expect(normalizeNoticeLanguage(undefined)).toBe('en')
    })
})

describe('noticeText', () => {
    test('fills placeholders and keeps unknown ones visible', () => {
        expect(noticeText('de', 'preconfig.done', { label: 'PT-7' })).toBe('✅ PT-7 ist erledigt.')
        expect(noticeText('es', 'preconfig.done', { label: 'PT-7' })).toBe('✅ PT-7 está terminada.')
        expect(noticeText('fr', 'preconfig.done', { label: 'PT-7' })).toBe('✅ PT-7 is done.')
        expect(noticeText('en', 'preconfig.done')).toBe('✅ {label} is done.')
    })

    test('a value is inserted literally, even when it looks like a placeholder', () => {
        expect(noticeText('en', 'actor.movedBy', { name: '{label} $&' })).toBe('{label} $& moved it.')
    })
})

describe('labels', () => {
    test('quotes a task name in the language’s quotation marks', () => {
        const task = { humanReadableId: 'PT-7', extendedName: 'Historical fact of the day' }
        expect(buildNoticeTaskLabel(task, 'en')).toBe('PT-7 “Historical fact of the day”')
        expect(buildNoticeTaskLabel(task, 'de')).toBe('PT-7 „Historical fact of the day“')
        expect(buildNoticeTaskLabel({ name: 'X' }, 'de')).toBe('„X“')
        expect(buildNoticeTaskLabel({ humanReadableId: 'PT-8' }, 'de')).toBe('„Unbenannter Task“')
        expect(quoteNotice('es', 'Revisar')).toBe('“Revisar”')
    })

    test('translates the built-in step names and keeps the user’s own', () => {
        expect(noticeStepLabel('de', 'Open')).toBe('Offen')
        expect(noticeStepLabel('de', 'Done')).toBe('Erledigt')
        expect(noticeStepLabel('de', 'Workflow step')).toBe('Workflow-Schritt')
        expect(noticeStepLabel('de', '')).toBe('Workflow-Schritt')
        expect(noticeStepLabel('de', 'Check what AI did')).toBe('Check what AI did')
    })
})

describe('loadNoticeLanguage', () => {
    const dbWith = value => ({
        doc: jest.fn(() => ({
            get: () =>
                value instanceof Error
                    ? Promise.reject(value)
                    : Promise.resolve({ exists: value !== null, data: () => value }),
        })),
    })

    test("reads the user's app language", async () => {
        const db = dbWith({ language: 'de' })
        await expect(loadNoticeLanguage(db, 'user-1')).resolves.toBe('de')
        expect(db.doc).toHaveBeenCalledWith('users/user-1')
    })

    test('falls back to English for a missing user, a missing id or a read error', async () => {
        await expect(loadNoticeLanguage(dbWith(null), 'user-1')).resolves.toBe('en')
        await expect(loadNoticeLanguage(dbWith({ language: 'de' }), '')).resolves.toBe('en')
        await expect(loadNoticeLanguage(dbWith(new Error('unavailable')), 'user-1')).resolves.toBe('en')
    })
})
