/**
 * AT-2873 browser harness: wiki bullet lists should be laid out like note bullet lists.
 *
 * Mounts the REAL `WikiMarkdown` (react-native-web, the same component WikiView renders) next to a
 * REAL notes list: the DOM Quill 2 produces for a bulleted list (`ol > li[data-list] > span.ql-ui`)
 * styled by the notes editor's own `toolbar-styles.css`. jsdom computes no layout, so only a real
 * browser can show where a marker sits, how far the text starts from it, and where a wrapped line
 * continues.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { View } from 'react-native'

import '../../components/NotesView/NotesDV/EditorView/toolbar-styles.css'
import WikiMarkdown from '../../components/WikiView/WikiMarkdown'
import { loadAsync } from '../../utils/WebShims/Fonts'
import RobotoMedium from '../../assets/fonts/Roboto-Medium.ttf'
import RobotoRegular from '../../assets/fonts/Roboto-Regular.ttf'

const params = new URLSearchParams(window.location.search)
const width = Number(params.get('width')) || 640

// The page from the report (AT-2873): long items that wrap, several source chips per item, bold text.
export const WIKI_BODY = [
    '## Mercedes B',
    '',
    '- Auto (B-Klasse, Kennzeichen WY 241) vom Vater übernommen. [[note:n1]]',
    '- Versicherung: Teilkasko bei AXA (AXA easy), seit 02/2026; Upgrade geplant, sobald Daniela mitversichert ist. [[note:n1]]',
    '- 06/2026: Mercedes soll die jährliche Wartung machen. [[note:n1]]',
    '- Service (07/2026): Mercedes-Benz **Niederlassung Berlin** bestätigte den Serviceauftrag vom 13.07.2026 für BWY241 / B 180; der unterschriebene Auftrag mit den vereinbarten Service-Umfängen liegt per E-Mail vor. [[note:n2]] [[contact:c1]]',
    '  - Nested: Ölwechsel, Bremsflüssigkeit und Inspektion nach Herstellervorgabe; Rechnung folgt nach Abholung. [[note:n2]]',
    '    - Third level item that is also long enough to wrap onto a second line at most widths. [[note:n1]]',
    '- Werkstatt: Mercedes Spandau (u. a. Herr Schulz, Herr Koshevski als Mercedes-me-Experte); Herr Reschek nimmt das Auto für Messungen entgegen. [[note:n1]]',
    '',
    '1. First ordered step that is long enough to wrap onto a second line on narrow screens. [[note:n1]]',
    '2. Second ordered step.',
    '3. Third',
    '4. Fourth',
    '5. Fifth',
    '6. Sixth',
    '7. Seventh',
    '8. Eighth',
    '9. Ninth',
    '10. Tenth ordered step, two digits, also long enough to wrap onto a second line. [[note:n1]]',
].join('\n')

const SOURCE_LABELS = {
    'note:n1': 'Mercedes Auto B WY 241',
    'note:n2': 'Niederlassung Berlin',
    'contact:c1': 'Niederlassung Berlin',
}

const NOTES_ITEMS = [
    {
        indent: 0,
        text: 'Auto (B-Klasse, Kennzeichen WY 241) vom Vater übernommen und seitdem regelmäßig gewartet, damit es lange hält.',
    },
    {
        indent: 1,
        text: 'Nested: Ölwechsel, Bremsflüssigkeit und Inspektion nach Herstellervorgabe; Rechnung folgt nach Abholung.',
    },
    { indent: 2, text: 'Third level item that is also long enough to wrap onto a second line at most widths.' },
]

const NOTES_ORDERED = [
    'First ordered step that is long enough to wrap onto a second line on narrow screens.',
    ...['Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'],
    'Tenth ordered step, two digits, also long enough to wrap onto a second line.',
]

const notesItem = (list, indent, text) =>
    `<li data-list="${list}"${indent ? ` class="ql-indent-${indent}"` : ''}>` +
    '<span class="ql-ui" contenteditable="false"></span>' +
    `<span class="notes-text">${text}</span></li>`

function NotesList() {
    // Exactly the DOM Quill 2 renders for a list; the marker comes from `.ql-ui::before`.
    const html =
        '<ol>' +
        NOTES_ITEMS.map(item => notesItem('bullet', item.indent, item.text)).join('') +
        '</ol><p><br></p><ol>' +
        NOTES_ORDERED.map(text => notesItem('ordered', 0, text)).join('') +
        '</ol>'
    return (
        <div className="ql-container ql-snow" style={{ width, paddingBottom: 0 }} data-testid="notes">
            <div className="ql-editor" style={{ padding: 0 }} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
    )
}

function Harness() {
    return (
        <div style={{ padding: 16 }}>
            <View testID="wiki" style={{ width }}>
                <WikiMarkdown body={WIKI_BODY} sourceLabels={SOURCE_LABELS} />
            </View>
            <div style={{ height: 32 }} />
            <NotesList />
        </div>
    )
}

// The app's own fonts, loaded the way App.js loads them: marker and number widths depend on them.
loadAsync({ 'Roboto-Regular': { uri: RobotoRegular }, 'Roboto-Medium': { uri: RobotoMedium } }).then(() => {
    createRoot(document.getElementById('root')).render(<Harness />)
    window.__harnessReady = true
})
