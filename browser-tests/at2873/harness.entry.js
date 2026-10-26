/**
 * AT-2873 browser harness: wiki list layout.
 *
 * Mounts the REAL `WikiMarkdown` (react-native-web, the same component WikiView renders) with the
 * app's fonts. jsdom computes no layout, so only a real browser can show where a marker sits
 * relative to the heading and paragraph around it, how far the text starts from it, and where a
 * wrapped line continues.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { View } from 'react-native'

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
    'Paragraph before the list: the content edge every top-level list marker has to line up with.',
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

function Harness() {
    return (
        <div style={{ padding: 16 }}>
            <View testID="wiki" style={{ width }}>
                <WikiMarkdown body={WIKI_BODY} sourceLabels={SOURCE_LABELS} />
            </View>
        </div>
    )
}

// The app's own fonts, loaded the way App.js loads them: marker and number widths depend on them.
loadAsync({ 'Roboto-Regular': { uri: RobotoRegular }, 'Roboto-Medium': { uri: RobotoMedium } }).then(() => {
    createRoot(document.getElementById('root')).render(<Harness />)
    window.__harnessReady = true
})
