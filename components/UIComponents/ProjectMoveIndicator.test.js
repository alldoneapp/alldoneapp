const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '../..')
const listRows = [
    'components/TaskListView/TaskItem/TaskPresentation/TaskPresentation.js',
    'components/NotesView/NotesItem.js',
    'components/GoalsView/GoalItemPresentation.js',
    'components/ContactsView/ContactItem.js',
    'components/ChatsView/ChatItem.js',
    'components/SettingsView/Profile/Skills/SkillItem/SkillPresentation.js',
]

describe('AT-2572 project move list indicators', () => {
    test.each(listRows)('%s renders the shared pending indicator', relativePath => {
        const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

        expect(source).toMatch(/import ProjectMoveIndicator from/)
        expect(source).toMatch(/<ProjectMoveIndicator object=\{(?:task|note|goal|contact|chat|skill)\}/)
    })

    it('keeps move metadata in every mapped list object', () => {
        const source = fs.readFileSync(path.join(repoRoot, 'utils/backends/firestore.js'), 'utf8')
        const mapperNames = ['mapNoteData', 'mapGoalData', 'mapTaskData', 'mapSkillData', 'mapContactData']

        mapperNames.forEach((name, index) => {
            const start = source.indexOf(`export function ${name}`)
            const end = index + 1 < mapperNames.length ? source.indexOf('export function ', start + 16) : source.length
            const mapper = source.slice(start, end)
            expect(mapper).toMatch(/projectMove:/)
            expect(mapper).toMatch(/movingToOtherProjectId:/)
        })
    })

    it('renders contact move progress in the detail header and keeps the source view during handoff', () => {
        const header = fs.readFileSync(path.join(repoRoot, 'components/ContactDetailedView/Header/Header.js'), 'utf8')
        const detail = fs.readFileSync(
            path.join(repoRoot, 'components/ContactDetailedView/ContactDetailedView.js'),
            'utf8'
        )
        expect(header).toMatch(/<ProjectMoveIndicator object=\{contact\} projectId=\{projectId\} showLabel/)
        expect(detail).toMatch(/!contact && isLocalContactMovePending\(projectId, contactParam\.uid\)/)
    })
})
