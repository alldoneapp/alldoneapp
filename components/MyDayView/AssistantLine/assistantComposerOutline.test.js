/**
 * AT-3031 — the assistant line's composer box has a soft blue outline at rest and a brand-blue
 * border with a glow while the editor has focus, in light and dark mode.
 */
import fs from 'fs'
import path from 'path'

import { colors } from '../../styles/global'

const readSource = file => fs.readFileSync(path.join(__dirname, file), 'utf8')

describe('assistant composer outline', () => {
    it('rests on the adaptive UtilityBlue150 token, not the near-invisible Grey300', () => {
        const source = readSource('AssistantOptions/AssistantOptions.js')
        const composerBox = source.match(/composerBox: \{([^}]*)\}/)
        expect(composerBox).not.toBeNull()
        expect(composerBox[1]).toMatch(/borderWidth: 1,/)
        expect(composerBox[1]).toMatch(/borderColor: colors\.UtilityBlue150,/)
        // A theme token (var(--ad-…)), so it flips with light/dark mode.
        expect(colors.UtilityBlue150).toMatch(/^var\(--ad-UtilityBlue150/)
    })

    it('turns brand blue with a glow only while the editor is focused, without a layout shift', () => {
        const css = readSource('assistantInput.css')
        const rule = css.match(/\[data-testid='assistant-composer-row'\]:has\(\.ql-editor:focus\) \{([^}]*)\}/)
        expect(rule).not.toBeNull()
        expect(rule[1]).toMatch(/border-color: #0c66ff/i)
        expect(rule[1]).toMatch(/box-shadow: 0 0 0 3px rgba\(12, 102, 255, 0\.18\)/)
        // The focus state must not change the border width: the toolbar would jump.
        expect(rule[1]).not.toMatch(/border-width/)
    })
})
