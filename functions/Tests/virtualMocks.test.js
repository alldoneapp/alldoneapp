/** @jest-environment node */
// `jest.mock(name, factory, { virtual: true })` is for a module that does not exist on disk.
// Used for one that does, it makes other suites fail depending on the order they run in.
//
// Jest keeps one resolver per worker and caches, per requiring file, the id it worked out for
// each module name. Under a virtual mock that id is the bare name instead of the resolved path,
// and the cache outlives the suite. A later suite in the same worker that mocks the same module
// the normal way registers its mock under the resolved path, the shared module it tests still
// looks the mock up under the cached bare name, finds none and loads the real package.
//
// That is how `typesenseHelper.test.js` came to make real network calls (15 tests failing after
// 48 seconds) and `vmAgentSettings.test.js` to use the real firebase-admin, but only when
// `scopedSearchParentKey.test.js` or `vmThreadAgentContinuity.test.js` happened to run before
// them in the same worker: about one full run in five once a new slow suite changed how Jest
// spread the files over its workers (2026-11-18). 46 such mocks in 31 suites were made normal.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')

const FUNCTIONS = path.join(__dirname, '..')

const suites = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (entry.name === 'node_modules') return []
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) return suites(file)
        return /\.test\.js$/.test(entry.name) ? [file] : []
    })

// Every `jest.mock` / `jest.doMock` in `file` that passes `{ virtual: true }`.
const virtualMocks = file => {
    const source = fs.readFileSync(file, 'utf8')
    if (!source.includes('virtual')) return []
    const found = []
    const visit = node => {
        if (!node || typeof node.type !== 'string') return
        if (
            node.type === 'CallExpression' &&
            node.callee.type === 'MemberExpression' &&
            node.callee.object.name === 'jest' &&
            ['mock', 'doMock'].includes(node.callee.property.name) &&
            node.arguments[0]?.type === 'StringLiteral' &&
            node.arguments[2]?.type === 'ObjectExpression' &&
            node.arguments[2].properties.some(property => property.key?.name === 'virtual' && property.value.value)
        )
            found.push(node.arguments[0].value)
        for (const value of Object.values(node))
            if (Array.isArray(value)) value.forEach(visit)
            else if (value && typeof value === 'object') visit(value)
    }
    visit(parser.parse(source, { sourceType: 'unambiguous', plugins: ['jsx'] }).program)
    return found
}

const exists = (file, name) => {
    try {
        require.resolve(name, { paths: [path.dirname(file)] })
        return true
    } catch (_) {
        return false
    }
}

describe('virtual mocks', () => {
    const files = suites(FUNCTIONS)

    it('finds the suites at all, so this cannot pass on an empty list', () => {
        expect(files.length).toBeGreaterThan(100)
        expect(virtualMocks(__filename)).toEqual([])
    })

    it('are only used for modules that do not exist', () => {
        const misused = files.flatMap(file =>
            virtualMocks(file)
                .filter(name => exists(file, name))
                .map(name => `${path.relative(FUNCTIONS, file)}: ${name}`)
        )
        // Drop `{ virtual: true }` from each mock listed here: the module can be resolved.
        expect(misused).toEqual([])
    })
})
