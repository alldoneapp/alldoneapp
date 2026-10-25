const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')

const DETAIL_VIEW_FILES = [
    'components/ChatsView/ChatDetailedView.js',
    'components/TaskDetailedView/TaskDetailedView.js',
    'components/GoalDetailedView/GoalDetailedView.js',
    'components/ContactDetailedView/ContactDetailedView.js',
    'components/UserDetailedView/UserDetailedView.js',
    'components/AssistantDetailedView/AssistantDetailedView.js',
    'components/NotesView/NotesDV/Sections.js',
    'components/SkillDetailedView/DvContainer.js',
]

const readSource = relativePath => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')

describe('assistant fullscreen independence', () => {
    test.each(DETAIL_VIEW_FILES)('%s does not derive fullscreen state from assistantEnabled', relativePath => {
        const source = readSource(relativePath)

        expect(source).not.toMatch(/state\.assistantEnabled/)
        expect(source).not.toMatch(/setFullscreen\(assistantEnabled\)/)
        expect(source).not.toMatch(/setDvIsFullScreen\(assistantEnabled\)/)
    })

    test('note editor keeps its independent scroll and explicit fullscreen controls', () => {
        const source = readSource('components/NotesView/NotesDV/EditorView/NotesEditorView.js')

        expect(source).toContain('setFullscreen(true)')
        expect(source).toContain('setFullscreen(false)')
        expect(source).toContain('switchScreenModes(!isFullscreen)')
    })

    test('skill note keeps its independent fullscreen controls', () => {
        const containerSource = readSource('components/SkillDetailedView/DvContainer.js')
        const headerSource = readSource('components/SkillDetailedView/Header/Header.js')
        const sectionsSource = readSource('components/SkillDetailedView/Sections.js')

        expect(containerSource).toContain('dispatch(setDvIsFullScreen(false))')
        expect(headerSource).toContain('dispatch(setDvIsFullScreen(isFullScreen))')
        expect(sectionsSource).toContain('dispatch(setDvIsFullScreen(isFullScreen))')
    })
})
