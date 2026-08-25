/**
 * Guardrails for the add-task popup's project switcher (PT-4745).
 *
 * The product rule is "always show the project switcher, pre-selected to the
 * project you opened it from". Both halves fail SILENTLY at a call site — a
 * popup with no switcher just renders one row fewer, and a popup with no
 * project to pre-select renders a switcher that names nothing — so neither is
 * caught by a component test of the popup itself. These scan the call sites.
 *
 * The popup is `RichCreateTaskModal`, reached either directly or through the
 * `AddTaskTag` pill; `showProjectSelector` defaults to on, so a NEW entry point
 * is correct by doing nothing, and the only way back to the old behaviour is to
 * opt out explicitly.
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')

// The escape hatch is deliberately still available (see the prop's comment in
// RichCreateTaskModal) for a future surface that genuinely has no project to
// switch to — but it is unused today, and this may only ever go DOWN. If you
// are adding an opt-out, say in the test why that surface has no choice to
// offer; if you are removing one, lower the baseline.
const OPT_OUT_BASELINE = 0

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

const sourceFiles = () =>
    collectJsFiles(path.join(ROOT, 'components')).map(file => ({
        file: path.relative(ROOT, file),
        source: fs.readFileSync(file, 'utf8'),
    }))

// Each JSX usage of `tag`, from the opening angle bracket to the `/>` that
// closes it. Enough to read the props off a call site without a parser, and it
// cannot run past the element because these are all self-closing.
const jsxUsagesOf = (source, tag) => {
    const usages = []
    const opening = new RegExp(`<${tag}[\\s/>]`, 'g')
    let match
    while ((match = opening.exec(source)) !== null) {
        const end = source.indexOf('/>', match.index)
        if (end === -1) continue
        usages.push(source.slice(match.index, end + 2))
    }
    return usages
}

// A usage that forwards its whole prop bag (`{...props}`) is a pass-through
// wrapper, not an entry point: it does not choose a project, its caller does,
// and that caller is checked on its own. Skipping these is what keeps the rule
// about entry points rather than about spread syntax.
const choosesItsOwnProject = usage => !/\{\s*\.\.\.\s*\w+\s*\}/.test(usage)

describe('the add-task popup always offers the project switcher', () => {
    it('has no entry point opting out of it', () => {
        const optOuts = sourceFiles().filter(({ source }) =>
            /showProjectSelector\s*=\s*\{\s*false\s*\}|showProjectSelector\s*:\s*false/.test(source)
        )

        expect(optOuts.map(({ file }) => file).length).toBeLessThanOrEqual(OPT_OUT_BASELINE)
    })
})

describe('the add-task popup always knows which project to pre-select', () => {
    // `initialProjectId` is the ONLY input the popup reads for its starting
    // project — there is no fallback to the selected project index — so a call
    // site that omits it opens on `undefined` and files the task nowhere.
    it('passes initialProjectId at every RichCreateTaskModal call site', () => {
        const offenders = []
        for (const { file, source } of sourceFiles()) {
            for (const usage of jsxUsagesOf(source, 'RichCreateTaskModal')) {
                if (choosesItsOwnProject(usage) && !usage.includes('initialProjectId')) offenders.push(file)
            }
        }

        expect(offenders).toEqual([])
    })

    it('passes projectId at every AddTaskTag call site', () => {
        const offenders = []
        for (const { file, source } of sourceFiles()) {
            for (const usage of jsxUsagesOf(source, 'AddTaskTag')) {
                if (choosesItsOwnProject(usage) && !/\bprojectId\s*=/.test(usage)) offenders.push(file)
            }
        }

        expect(offenders).toEqual([])
    })
})
