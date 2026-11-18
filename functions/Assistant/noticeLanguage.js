'use strict'

/**
 * The fixed lines Anna posts about a task in another conversation, in the recipient's language
 * (AT-3082, Karsten 2026-11-18: "überall lokalisieren").
 *
 * These notices (a template's task started/finished, a delegated task ready for review or moved to
 * another step, a VM that needs input or finished) are written by the server, not by the model, so
 * they used to be English for everybody. Functions cannot import the app's `i18n/translations`, so
 * this is a small server-side table for en, de and es. Anything else falls back to English.
 *
 * Only the fixed words are translated. Task names, step names, VM questions and Anna's summaries are
 * inserted as they are (a summary is already written in the user's language by vmResultSummary).
 */

const admin = require('firebase-admin')

const NOTICE_LANGUAGES = ['en', 'de', 'es']
const DEFAULT_NOTICE_LANGUAGE = 'en'

const NOTICE_STRINGS = {
    en: {
        'quote.open': '“',
        'quote.close': '”',
        'task.unnamed': 'Untitled task',

        'preconfig.start': '🚀 I started {label} for you. I will tell you here when it is done.',
        'preconfig.failed': '⚠️ {label} could not finish. The details are in the task.',
        'preconfig.waiting': '💬 {label} is ready and waits for your message in the task.',
        'preconfig.noAnswer': '✅ {label} finished without an answer to report.',
        'preconfig.done': '✅ {label} is done.',
        'preconfig.result': '✅ {label} has its result.',

        'step.open': 'Open',
        'step.done': 'Done',
        'step.review': 'Review',
        'step.workflow': 'Workflow step',
        'handler.assistant': 'assistant',
        'handler.you': 'you',
        'handler.task owner': 'task owner',
        'handler.another member': 'another member',
        'review.ready': '📋 {label} is ready for you at {step}.',
        'review.replyDone': 'Reply “done” to complete it, or tell me what to change.',
        'review.next': 'Next: {next}{who}. Reply here to approve, for example “go ahead”, or tell me what to change.',
        'change.done': '✅ {label} is done (it was at {from}).',
        'change.open': '↩️ {label} is back in Open (it was at {from}).',
        'change.moved': '🔀 {label} moved from {from} to {to}{waiting}.',
        'waiting.assistant': 'the assistant works on it now',
        'waiting.you': 'it waits for you',
        'waiting.another member': 'it waits for another member',
        'actor.completedSelf': 'You completed it yourself.',
        'actor.movedSelf': 'You moved it yourself.',
        'actor.completedBy': '{name} completed it.',
        'actor.movedBy': '{name} moved it.',
        'actor.anotherMember': 'Another member',

        'vmInput.agent': 'The VM',
        'vmInput.on': ' on {subject}',
        'vmInput.plan': '🗒️ {agent} prepared a plan{on} and waits for your review before it runs.',
        'vmInput.approval': '🔐 {agent} needs your approval{on} before it continues{tool}.',
        'vmInput.input': '💬 {agent} needs your input{on} before it continues.',
        'vmInput.answer': 'Answer it in the task chat: {link}',

        'vmResult.subject': 'The VM task {label}',
        'vmResult.subjectGeneric': 'The VM task you requested',
        'vmResult.completed': 'finished',
        'vmResult.cancelled': 'was cancelled',
        'vmResult.interrupted': 'was interrupted',
        'vmResult.failed': 'failed',
    },
    de: {
        'quote.open': '„',
        'quote.close': '“',
        'task.unnamed': 'Unbenannter Task',

        'preconfig.start': '🚀 Ich habe {label} für dich gestartet. Ich melde mich hier, sobald es fertig ist.',
        'preconfig.failed': '⚠️ {label} konnte nicht abgeschlossen werden. Die Details stehen im Task.',
        'preconfig.waiting': '💬 {label} ist bereit und wartet im Task auf deine Nachricht.',
        'preconfig.noAnswer': '✅ {label} ist fertig, ohne Antwort, die ich berichten könnte.',
        'preconfig.done': '✅ {label} ist erledigt.',
        'preconfig.result': '✅ {label} hat ein Ergebnis.',

        'step.open': 'Offen',
        'step.done': 'Erledigt',
        'step.review': 'Prüfung',
        'step.workflow': 'Workflow-Schritt',
        'handler.assistant': 'Assistent',
        'handler.you': 'du',
        'handler.task owner': 'Task-Inhaber',
        'handler.another member': 'anderes Mitglied',
        'review.ready': '📋 {label} ist bei {step} bereit für dich.',
        'review.replyDone': 'Antworte „erledigt“, um ihn abzuschließen, oder sag mir, was ich ändern soll.',
        'review.next':
            'Als Nächstes: {next}{who}. Antworte hier zur Freigabe, zum Beispiel „mach weiter“, oder sag mir, was ich ändern soll.',
        'change.done': '✅ {label} ist erledigt (vorher bei {from}).',
        'change.open': '↩️ {label} ist wieder offen (vorher bei {from}).',
        'change.moved': '🔀 {label} ist von {from} zu {to} gewechselt{waiting}.',
        'waiting.assistant': 'der Assistent arbeitet jetzt daran',
        'waiting.you': 'er wartet auf dich',
        'waiting.another member': 'er wartet auf ein anderes Mitglied',
        'actor.completedSelf': 'Du hast ihn selbst abgeschlossen.',
        'actor.movedSelf': 'Du hast ihn selbst verschoben.',
        'actor.completedBy': '{name} hat ihn abgeschlossen.',
        'actor.movedBy': '{name} hat ihn verschoben.',
        'actor.anotherMember': 'Ein anderes Mitglied',

        'vmInput.agent': 'Die VM',
        'vmInput.on': ' zu {subject}',
        'vmInput.plan': '🗒️ {agent} hat einen Plan{on} vorbereitet und wartet auf deine Prüfung, bevor es losgeht.',
        'vmInput.approval': '🔐 {agent} braucht deine Freigabe{on}, bevor es weitergeht{tool}.',
        'vmInput.input': '💬 {agent} braucht deine Antwort{on}, bevor es weitergeht.',
        'vmInput.answer': 'Antworte im Task-Chat: {link}',

        'vmResult.subject': 'Die VM-Aufgabe {label}',
        'vmResult.subjectGeneric': 'Die angeforderte VM-Aufgabe',
        'vmResult.completed': 'ist abgeschlossen',
        'vmResult.cancelled': 'wurde abgebrochen',
        'vmResult.interrupted': 'wurde unterbrochen',
        'vmResult.failed': 'ist fehlgeschlagen',
    },
    es: {
        'quote.open': '“',
        'quote.close': '”',
        'task.unnamed': 'Tarea sin título',

        'preconfig.start': '🚀 He iniciado {label} para ti. Te avisaré aquí cuando esté lista.',
        'preconfig.failed': '⚠️ {label} no pudo terminar. Los detalles están en la tarea.',
        'preconfig.waiting': '💬 {label} está lista y espera tu mensaje en la tarea.',
        'preconfig.noAnswer': '✅ {label} terminó sin una respuesta que comunicar.',
        'preconfig.done': '✅ {label} está terminada.',
        'preconfig.result': '✅ {label} ya tiene su resultado.',

        'step.open': 'Abierta',
        'step.done': 'Hecha',
        'step.review': 'Revisión',
        'step.workflow': 'Paso del flujo',
        'handler.assistant': 'asistente',
        'handler.you': 'tú',
        'handler.task owner': 'responsable de la tarea',
        'handler.another member': 'otro miembro',
        'review.ready': '📋 {label} está lista para ti en {step}.',
        'review.replyDone': 'Responde “hecho” para completarla, o dime qué cambiar.',
        'review.next':
            'Siguiente: {next}{who}. Responde aquí para aprobar, por ejemplo “adelante”, o dime qué cambiar.',
        'change.done': '✅ {label} está terminada (estaba en {from}).',
        'change.open': '↩️ {label} vuelve a estar abierta (estaba en {from}).',
        'change.moved': '🔀 {label} pasó de {from} a {to}{waiting}.',
        'waiting.assistant': 'el asistente trabaja en ella ahora',
        'waiting.you': 'te espera a ti',
        'waiting.another member': 'espera a otro miembro',
        'actor.completedSelf': 'La completaste tú.',
        'actor.movedSelf': 'La moviste tú.',
        'actor.completedBy': '{name} la completó.',
        'actor.movedBy': '{name} la movió.',
        'actor.anotherMember': 'Otro miembro',

        'vmInput.agent': 'La VM',
        'vmInput.on': ' en {subject}',
        'vmInput.plan': '🗒️ {agent} preparó un plan{on} y espera tu revisión antes de ejecutarlo.',
        'vmInput.approval': '🔐 {agent} necesita tu aprobación{on} antes de continuar{tool}.',
        'vmInput.input': '💬 {agent} necesita tu respuesta{on} antes de continuar.',
        'vmInput.answer': 'Respóndela en el chat de la tarea: {link}',

        'vmResult.subject': 'La tarea de VM {label}',
        'vmResult.subjectGeneric': 'La tarea de VM que pediste',
        'vmResult.completed': 'terminó',
        'vmResult.cancelled': 'fue cancelada',
        'vmResult.interrupted': 'fue interrumpida',
        'vmResult.failed': 'falló',
    },
}

/** 'de-DE', 'DE', ' es ' → 'de' / 'es'; anything unsupported → 'en'. */
function normalizeNoticeLanguage(language) {
    const code = String(language || '')
        .trim()
        .toLowerCase()
        .split(/[-_]/)[0]
    return NOTICE_LANGUAGES.includes(code) ? code : DEFAULT_NOTICE_LANGUAGE
}

/** The fixed text for `key` in `language`, with `{name}` placeholders filled from `vars`. */
function noticeText(language, key, vars = {}) {
    const table = NOTICE_STRINGS[normalizeNoticeLanguage(language)]
    const template = table[key] ?? NOTICE_STRINGS[DEFAULT_NOTICE_LANGUAGE][key] ?? key
    return template.replace(/\{([^}]+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : match
    )
}

/** A user-written name (task, step) in the language's quotation marks. */
function quoteNotice(language, value) {
    return `${noticeText(language, 'quote.open')}${value}${noticeText(language, 'quote.close')}`
}

/** `PT-7 „Name“`, `„Name“`, or the quoted "Untitled task" when the task has no name. */
function buildNoticeTaskLabel(task, language) {
    const name = String(task?.extendedName || task?.name || '').trim()
    const quoted = quoteNotice(language, name || noticeText(language, 'task.unnamed'))
    return name && task?.humanReadableId ? `${task.humanReadableId} ${quoted}` : quoted
}

/** A step name for a notice: Open, Done and unnamed steps are translated, the user's own names kept. */
function noticeStepLabel(language, label) {
    const value = String(label || '').trim()
    if (value === 'Open') return noticeText(language, 'step.open')
    if (value === 'Done') return noticeText(language, 'step.done')
    if (!value || value === 'Workflow step') return noticeText(language, 'step.workflow')
    return value
}

/**
 * The recipient's app language (`users/{uid}.language`), normalized. A notice is never held up by
 * this: a missing user or a read error means English.
 */
async function loadNoticeLanguage(db = admin.firestore(), userId) {
    if (typeof userId !== 'string' || !userId) return DEFAULT_NOTICE_LANGUAGE
    try {
        const snapshot = await db.doc(`users/${userId}`).get()
        return normalizeNoticeLanguage(snapshot?.exists ? snapshot.data()?.language : '')
    } catch (error) {
        return DEFAULT_NOTICE_LANGUAGE
    }
}

module.exports = {
    DEFAULT_NOTICE_LANGUAGE,
    NOTICE_LANGUAGES,
    NOTICE_STRINGS,
    buildNoticeTaskLabel,
    loadNoticeLanguage,
    noticeStepLabel,
    noticeText,
    normalizeNoticeLanguage,
    quoteNotice,
}
