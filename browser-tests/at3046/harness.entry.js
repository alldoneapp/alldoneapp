/**
 * AT-3046 browser harness: the Assistant sidebar's activity rows as cards (variant C).
 *
 * Mounts the REAL `AnnaActivityGroup` with the REAL `anna.css` and Anna's theme variables inside
 * the same DOM skeleton the assistant shell renders, at the chat width and colour mode chosen by
 * `run.js` (`?width=380&mode=dark`). Covers every kind of row the sidebar shows: a single reply,
 * several replies to one object, a state change, a row from another project, a row from another
 * actor, a row that is not enriched yet, long titles/previews, and the system notices in between.
 */
import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import { setColorModePreference } from '../../Themes/colorMode'
import '../../components/Anna/anna.css'
import { ANNA_THEME_VARIABLES } from '../../components/Anna/annaThemeVariables'
import { AnnaActivityGroup } from '../../components/Anna/AnnaActivityNotice'
import AnnaTimestamp from '../../components/Anna/AnnaTimestamp'
import { setLanguage } from '../../i18n/TranslationService'
import AllDoneFont from '../../assets/fonts/alldone.ttf'

const params = new URLSearchParams(window.location.search)
const MODE = params.get('mode') === 'light' ? 'light' : 'dark'
setColorModePreference(MODE)
setLanguage('de')

const PROJECT_ID = 'proj-product'
const OTHER_PROJECT_ID = 'proj-business'
const UID = 'user-1'
const ASSISTANT = 'Alldone CTO'
const user = {
    uid: UID,
    displayName: 'Karsten Wysk',
    email: 'k@e.st',
    photoURL: '',
    photoURL300: '',
    defaultProjectId: PROJECT_ID,
    activeProjects: [PROJECT_ID, OTHER_PROJECT_ID],
    inactiveProjects: [],
    projectIds: [PROJECT_ID, OTHER_PROJECT_ID],
    isAnonymous: false,
    premium: { status: 'premium' },
}
store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })

const at = (hours, minutes) => new Date(2026, 10, 13, hours, minutes).getTime()
// `userId` is not the logged user: rows render from their saved content and never try to
// enrich or publish (both read Firestore, which nothing answers here).
const row = (id, { kind = 'chat', projectId = PROJECT_ID, projectName = 'Alldone Product', created, content }) => ({
    id: kind === 'chat' ? `chat/${projectId}/${id}/c-${id}` : `feed/${projectId}/tasks/${id}/f-${id}`,
    userId: 'someone-else',
    kind,
    projectId: PROJECT_ID,
    chatId: 'anna',
    sourceProjectId: projectId,
    projectName,
    created,
    path: '/',
    content: content && { version: 1, objectType: 'tasks', ...content },
})
const reply = (title, preview) => ({ objectName: title, preview, actorName: ASSISTANT })

// [case, notices, unread]
const ROWS = [
    [
        'unread-reply',
        [
            row('t1', {
                created: at(17, 45),
                content: reply(
                    'Im Dark Mode sollte auch die Rückfrage von Claude lesbar sein',
                    'MR 856 ist in `master` gemergt, und die Änderung ist mit der Production-Pipeline live gegangen. Alles grün.'
                ),
            }),
        ],
        true,
    ],
    [
        'unread-long',
        [
            row('t2', {
                created: at(17, 45),
                content: reply(
                    'Bei den Assistant Names nie auf 2 Zeilen gehen (Sidebar), auch nicht bei sehr langen Namen wie diesem hier',
                    'Der Merge hat geklappt und der Fix ist live in Production. Die Pipeline hat alle Jobs grün abgeschlossen, inklusive der Browser-Tests, der Functions-Suite und des Firestore-Index-Checks, der bei langen Läufen gern mal hängt. Sag Bescheid, wenn noch etwas fehlt.'
                ),
            }),
        ],
        true,
    ],
    [
        'grouped',
        [
            row('t3', {
                kind: 'feed',
                created: at(17, 45),
                content: {
                    objectName: 'Bitte nimm hier im empty inbox modus das Anna Logo',
                    actorName: ASSISTANT,
                    entryText: 'checked task as Done',
                },
            }),
            row('t3', {
                created: at(17, 46),
                content: reply(
                    'Bitte nimm hier im empty inbox modus das Anna Logo',
                    'MR !858 ist gemergt, und das Production-Deployment ist durchgelaufen: Die Änderung ist live.'
                ),
            }),
        ],
        true,
    ],
    [
        'read-reply',
        [
            row('t4', {
                created: at(17, 45),
                content: reply(
                    'Anstatt vom X mach das Gegenstück zum Expand-Icon',
                    'AT-3042 ist umgesetzt: Rechts im Anna-Header steht statt des X jetzt das Panel-Icon mit Pfeil nach rechts.'
                ),
            }),
        ],
        false,
    ],
    [
        'other-project',
        [
            row('t5', {
                kind: 'feed',
                projectId: OTHER_PROJECT_ID,
                projectName: 'Alldone Business',
                created: at(19, 12),
                content: {
                    objectName: 'Rechnung Q4 an Steuerberater',
                    actorName: 'Daniela',
                    entryText: 'checked task as Done',
                },
            }),
        ],
        true,
    ],
    [
        'other-actor',
        [
            row('t6', {
                created: at(19, 30),
                content: {
                    objectName: 'Verbessere das Layout hier bei einem call in der Sidebar',
                    preview: 'Sieht gut aus, nur der Abstand oben ist noch etwas groß.',
                    actorName: 'Daniela',
                },
            }),
        ],
        false,
    ],
    ['not-enriched', [row('t7', { created: at(19, 45) })], true],
]

function Harness() {
    const width = Number(params.get('width')) || 380
    const context = { projectId: PROJECT_ID, assistantName: ASSISTANT }
    return (
        <div
            className="anna-shell anna-zoom-shell"
            style={{ ...ANNA_THEME_VARIABLES, '--anna-chat-width': `${width}px` }}
        >
            <div className="anna-layout">
                <div className="anna-conversation">
                    <div className="anna-messages" role="log" tabIndex={0}>
                        <div className="anna-message-timeline">
                            <section>
                                <div className="anna-date-divider">2026-11-13 · Alldone Product · {ASSISTANT}</div>
                                {ROWS.map(([name, notices, unread]) => (
                                    <div key={name} data-case={name}>
                                        <AnnaActivityGroup notices={notices} unread={unread} context={context} />
                                    </div>
                                ))}
                                <p className="anna-context-notice anna-project-switch-notice">
                                    <span>Projekt gewechselt: Alldone Product</span>
                                    <AnnaTimestamp timestamp={at(20, 6)} />
                                </p>
                                <p className="anna-context-notice anna-view-notice">
                                    <span>
                                        Geöffnet: Alldone Product – User – Tasks – Folgende Woche mit einem sehr langen
                                        Ansichtsnamen
                                    </span>
                                    <AnnaTimestamp timestamp={at(20, 6)} />
                                </p>
                            </section>
                        </div>
                    </div>
                </div>
                <div className="anna-divider" />
                <div className="anna-stage" />
            </div>
        </div>
    )
}

new FontFace('alldone', `url(${AllDoneFont})`)
    .load()
    .then(font => document.fonts.add(font))
    .catch(() => {})
    .finally(() => {
        initFirebase(() => {})
        createRoot(document.getElementById('root')).render(
            <Provider store={store}>
                <Harness />
            </Provider>
        )
    })
