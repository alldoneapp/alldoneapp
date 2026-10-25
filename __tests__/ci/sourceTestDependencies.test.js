/** @jest-environment node */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { sourceTestAffected } = require('../../ci/sourceTestDependencies')
describe('filesystem test dependencies', () => {
    let root, file
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-tests-'))
        fs.mkdirSync(path.join(root, 'tests'))
        file = path.join(root, 'tests/source.test.js')
    })
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
    const affected = (source, inputs) => {
        fs.writeFileSync(file, source)
        return sourceTestAffected(root, file, inputs)
    }
    it('follows constants and path joins to the exact file', () => {
        const source =
            "const fs = require('fs'); const path = require('path'); const root = path.resolve(__dirname, '..'); const source = path.join(root, 'components', 'Foo.js'); fs.readFileSync(source)"
        expect(affected(source, ['components/Foo.js'])).toBe(true)
        expect(affected(source, ['components/Bar.js'])).toBe(false)
    })
    it('matches directory reads only under that directory', () => {
        const source = "const fs = require('fs'); fs.readdirSync('components')"
        expect(affected(source, ['components/sub/Foo.js'])).toBe(true)
        expect(affected(source, ['utils/Foo.js'])).toBe(false)
    })
    it('retains only the uncertain suite when a read cannot be resolved', () => {
        expect(affected('fs.readFileSync(computePath())', ['components/Foo.js'])).toBe(true)
    })
    it('follows renamed readers and computed filesystem methods', () => {
        expect(
            affected("const {readFileSync: readSource} = require('fs'); readSource('components/Foo.js')", [
                'components/Foo.js',
            ])
        ).toBe(true)
        expect(
            affected("const fs = require('fs'); fs['readFileSync']('components/Foo.js')", ['components/Foo.js'])
        ).toBe(true)
        expect(affected("const fs = require('fs'); fs[method]('components/Foo.js')", ['components/Foo.js'])).toBe(true)
    })
    it('ignores files outside the repository and tests with no filesystem reads', () => {
        expect(affected("fs.readFileSync('/private/tmp/test-output.json')", ['components/Foo.js'])).toBe(false)
        expect(affected("test('ok', () => {})", ['components/Foo.js'])).toBe(false)
    })
})
