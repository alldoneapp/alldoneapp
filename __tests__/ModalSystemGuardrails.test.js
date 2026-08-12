/**
 * Guardrails for the modal system (MODAL_IMPROVEMENT_PLAN.md).
 *
 * 1. Pins the design tokens the migrated popups rely on.
 * 2. Pins the vendored react-tiny-popover semantic that `contentLocation: null`
 *    (typeof 'object') disables the position-flip search — the behavior behind
 *    `nudgeIntoViewportWhen` and ~136 bare `cond ? null : undefined` sites.
 * 3. Ratchets the number of files using react-tiny-popover directly: it must
 *    only ever go DOWN as popups migrate onto the shared modal system. If you
 *    are adding a brand-new popup, build it on the shared tokens/hook (and the
 *    ModalShell once Phase 2 lands) instead of importing the library directly;
 *    if a file was deliberately migrated or deleted, lower the baseline.
 */
import fs from 'fs'
import path from 'path'

import {
    MODAL_EDGE_GAP,
    MODAL_SHEET_BREAKPOINT,
    MODAL_WIDTH_S,
    MODAL_WIDTH_M,
    MODAL_WIDTH_L,
    MODAL_WIDTH_XL,
} from '../components/styles/modals'
import { nudgeIntoViewportWhen } from '../utils/popoverPositioning'

const ROOT = path.join(__dirname, '..')

// 226 at the Phase 1 audit; Phase 2 migrated the six pilot wrappers onto
// AppPopover (−6) and added the shell itself (+2, one import + one comment
// mention — the ratchet matches file content, not just import lines).
const RAW_POPOVER_IMPORT_BASELINE = 222

const collectJsFiles = dir => {
    const results = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__snapshots__' || entry.name.startsWith('.')) continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            results.push(...collectJsFiles(fullPath))
        } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
            results.push(fullPath)
        }
    }
    return results
}

describe('modal design tokens', () => {
    it('keeps the width scale ascending', () => {
        expect(MODAL_WIDTH_S).toBeLessThan(MODAL_WIDTH_M)
        expect(MODAL_WIDTH_M).toBeLessThan(MODAL_WIDTH_L)
        expect(MODAL_WIDTH_L).toBeLessThan(MODAL_WIDTH_XL)
    })

    it('pins the edge gap and sheet breakpoint', () => {
        expect(MODAL_EDGE_GAP).toBe(16)
        expect(MODAL_SHEET_BREAKPOINT).toBe(640)
    })
})

describe('nudgeIntoViewportWhen (the contentLocation null idiom)', () => {
    it('returns null to enter nudge-only mode and undefined for library positioning', () => {
        expect(nudgeIntoViewportWhen(true)).toBeNull()
        expect(nudgeIntoViewportWhen(false)).toBeUndefined()
    })

    it('is still distinguished by the vendored react-tiny-popover', () => {
        // renderPopover skips the position-flip search only while
        // `typeof contentLocation === 'object'` — which is what makes `null`
        // (typeof 'object', but falsy) mean "nudge into the viewport, nothing
        // else". If this check disappears from the vendored dist (e.g. on a
        // library bump), the idiom silently stops working at every call site.
        const vendored = fs.readFileSync(
            path.join(ROOT, 'replacement_node_modules', 'react-tiny-popover', 'dist', 'Popover.js'),
            'utf8'
        )
        expect(vendored).toContain("typeof contentLocation === 'object'")
    })
})

describe('react-tiny-popover usage ratchet', () => {
    it('does not grow the number of files importing the library directly', () => {
        const files = [...collectJsFiles(path.join(ROOT, 'components')), ...collectJsFiles(path.join(ROOT, 'utils'))]
        const importers = files.filter(file => fs.readFileSync(file, 'utf8').includes('react-tiny-popover'))
        expect(importers.length).toBeLessThanOrEqual(RAW_POPOVER_IMPORT_BASELINE)
    })
})
