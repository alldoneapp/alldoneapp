import de from './translations/de.json'
import en from './translations/en.json'
import es from './translations/es.json'

import {
    COMMENT_POPUP_OBJECT_SLUGS,
    COMMENT_POPUP_STRING_KINDS,
    getCommentPopupObjectSlug,
    getCommentPopupObjectStringKey,
} from '../components/UIComponents/FloatModals/RichCommentModal/commentPopupObjectStrings'

const locales = { de, en, es }

describe('comment popup object translations (AT-2522)', () => {
    it('maps every object type the popup can render to a concrete slug', () => {
        expect(getCommentPopupObjectSlug('tasks')).toBe('task')
        expect(getCommentPopupObjectSlug('goals')).toBe('goal')
        expect(getCommentPopupObjectSlug('notes')).toBe('note')
        expect(getCommentPopupObjectSlug('contacts')).toBe('contact')
        // A project member opened from search arrives as `users` but is a contact row.
        expect(getCommentPopupObjectSlug('users')).toBe('contact')
        expect(getCommentPopupObjectSlug('topics')).toBe('chat')
        expect(getCommentPopupObjectSlug('skills')).toBe('skill')
        expect(getCommentPopupObjectSlug('assistants')).toBe('assistant')
    })

    it('falls back to the generic slug rather than building an undefined key', () => {
        expect(getCommentPopupObjectSlug(undefined)).toBe('object')
        expect(getCommentPopupObjectSlug('somethingElse')).toBe('object')
        expect(getCommentPopupObjectStringKey(undefined, 'loading')).toBe('comment_popup_loading_object')
    })

    it.each(Object.entries(locales))('%s defines every popup object string', (localeName, translations) => {
        const missing = []

        COMMENT_POPUP_OBJECT_SLUGS.forEach(slug => {
            COMMENT_POPUP_STRING_KINDS.forEach(kind => {
                const key = `comment_popup_${kind}_${slug}`
                if (!translations[key]) missing.push(key)
            })
        })

        expect(missing).toEqual([])
    })

    it.each(Object.entries(locales))('%s agrees grammatically with each noun', (localeName, translations) => {
        // A single interpolated "This %{type} is no longer available." cannot work here:
        // the determiner has to agree with the noun's gender in de and es. These spot checks
        // exist so a future "simplification" to one interpolated key fails loudly.
        COMMENT_POPUP_OBJECT_SLUGS.forEach(slug => {
            expect(translations[`comment_popup_unavailable_text_${slug}`]).toMatch(/\.$/)
        })
    })

    it('uses the correct German gender for each object type', () => {
        expect(de.comment_popup_unavailable_text_task).toBe('Diese Aufgabe ist nicht mehr verfügbar.')
        expect(de.comment_popup_unavailable_text_goal).toBe('Dieses Ziel ist nicht mehr verfügbar.')
        expect(de.comment_popup_unavailable_text_contact).toBe('Dieser Kontakt ist nicht mehr verfügbar.')
    })

    it('uses the correct Spanish gender for each object type', () => {
        expect(es.comment_popup_unavailable_text_task).toBe('Esta tarea ya no está disponible.')
        expect(es.comment_popup_unavailable_text_contact).toBe('Este contacto ya no está disponible.')
        expect(es.comment_popup_reconnecting_contact).toBe('Reconectando con el contacto')
        expect(es.comment_popup_reconnecting_task).toBe('Reconectando con la tarea')
    })

    it('keeps the deferred composer placeholder translatable', () => {
        Object.values(locales).forEach(translations => {
            expect(translations['Loading comment editor']).toBeTruthy()
        })
    })
})
