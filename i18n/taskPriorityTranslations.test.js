import i18n from 'i18n-js'

import { setLanguage, translate } from './TranslationService'
import de from './translations/de.json'
import en from './translations/en.json'
import es from './translations/es.json'
import { getTaskPriorityLabel, TASK_PRIORITIES } from '../utils/TaskPriority'

describe('task priority translations (AT-2670)', () => {
    const locales = { de, en, es }
    const keys = [
        'Priority',
        'Select priority',
        'Choose how important this task is',
        'Task Priorities',
        'Auto-postpone based on priorities',
        ...TASK_PRIORITIES.map(getTaskPriorityLabel),
    ]
    let originalLocale

    beforeEach(() => {
        originalLocale = i18n.locale
    })

    afterEach(() => {
        setLanguage(originalLocale)
    })

    it.each(Object.entries(locales))(
        '%s defines and resolves every priority label without fallback',
        (locale, strings) => {
            setLanguage(locale)
            keys.forEach(key => {
                expect(strings[key]).toEqual(expect.any(String))
                expect(strings[key].trim()).not.toBe('')
                expect(translate(key)).toBe(strings[key])
                expect(translate(key)).not.toContain('[missing')
            })
        }
    )
})
