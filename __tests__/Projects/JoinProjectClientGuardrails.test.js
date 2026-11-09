const fs = require('fs')
const path = require('path')

// Joining a project is joinProjectSecondGen's job (functions/Projects/joinProject.js): firestore.rules
// let only an existing member write a project's userIds, so a browser that adds itself is refused,
// and the invitation popup, template links and guide joins all failed exactly that way. Keep any
// client path from adding members to a project, or a guide to a template, again.

const ROOT = path.join(__dirname, '..', '..')

function listSourceFiles(dir) {
    const files = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) files.push(...listSourceFiles(fullPath))
        else if (/\.js$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) files.push(fullPath)
    }
    return files
}

const clientFiles = ['components', 'utils', 'URLSystem', 'hooks', 'redux'].flatMap(dir =>
    fs.existsSync(path.join(ROOT, dir)) ? listSourceFiles(path.join(ROOT, dir)) : []
)

describe('joining a project goes through joinProjectSecondGen', () => {
    it('no client code adds a member to a project document', () => {
        const offenders = clientFiles.filter(file => {
            const source = fs.readFileSync(file, 'utf8')
            return /doc\(`projects\/\$\{[^}]+\}`\)\s*,\s*\{\s*userIds:\s*firebase\.firestore\.FieldValue\.arrayUnion/.test(
                source
            )
        })
        expect(offenders.map(file => path.relative(ROOT, file))).toEqual([])
    })

    it('no client code adds a guide membership or links a guide into its template', () => {
        const offenders = clientFiles.filter(file =>
            /guideProjectIds:\s*firebase\.firestore\.FieldValue\.arrayUnion/.test(fs.readFileSync(file, 'utf8'))
        )
        expect(offenders.map(file => path.relative(ROOT, file))).toEqual([])
    })

    it('the invitation popup joins through the server', () => {
        const popup = fs.readFileSync(
            path.join(ROOT, 'components/UIComponents/ProjectInvitation/ProjectInvitationPopup.js'),
            'utf8'
        )
        expect(popup).toContain('joinProjectAsLoggedUser(project.id)')
        const usersFirestore = fs.readFileSync(path.join(ROOT, 'utils/backends/Users/usersFirestore.js'), 'utf8')
        expect(usersFirestore).toContain("runHttpsCallableFunction('joinProjectSecondGen'")
    })
})
