/**
 * Locale keys for the comment popup's own object states (loading, unavailable, reconnecting).
 *
 * These are named per concrete object type rather than interpolated from a generic
 * sentence, because a bare noun cannot be substituted into a demonstrative sentence in
 * German or Spanish: the determiner agrees with the noun's gender. "Diese Aufgabe" (f)
 * against "Dieses Ziel" (n) and "Dieser Kontakt" (m); "Esta tarea" (f) against
 * "Este contacto" (m). A single "This %{type} is no longer available." key would be
 * grammatically wrong for roughly half the types in two of the three shipped locales.
 *
 * The keys are semantic (`comment_popup_*`) rather than English-sentence keys on purpose.
 * In this codebase the English source string is normally the key, and a missing entry
 * therefore renders literally as `[missing "en.…" translation]` — which is exactly the
 * defect AT-2522 was reported for. An enumerable key family can be asserted complete by a
 * test (see i18n/commentPopupObjectTranslations.test.js), so the whole family cannot
 * silently regress again.
 */

// Every slug the popup can render. `object` is the fallback for an unknown object type.
export const COMMENT_POPUP_OBJECT_SLUGS = ['task', 'goal', 'note', 'contact', 'chat', 'skill', 'assistant', 'object']

export const COMMENT_POPUP_STRING_KINDS = [
    'loading',
    'unavailable',
    'unavailable_text',
    'reconnecting',
    'reconnecting_text',
]

const SLUG_BY_OBJECT_TYPE = {
    tasks: 'task',
    goals: 'goal',
    notes: 'note',
    contacts: 'contact',
    // `users` is normalized to `contacts` by the header before rendering, but a project
    // member opened from search still arrives with the raw type.
    users: 'contact',
    topics: 'chat',
    skills: 'skill',
    assistants: 'assistant',
}

export const getCommentPopupObjectSlug = objectType => SLUG_BY_OBJECT_TYPE[objectType] || 'object'

export const getCommentPopupObjectStringKey = (objectType, kind) =>
    `comment_popup_${kind}_${getCommentPopupObjectSlug(objectType)}`
