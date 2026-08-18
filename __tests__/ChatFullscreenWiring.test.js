const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')

// Every DV that shows a chat tab. The expanded layout lives in each DV's own header/navigation
// bar, so ChatBoard cannot switch it alone — a DV that forgets to hand its state down silently
// loses the feature with nothing failing.
const CHAT_TAB_FILES = [
    'components/ChatsView/ChatDetailedView.js',
    'components/TaskDetailedView/TaskDetailedView.js',
    'components/GoalDetailedView/GoalDetailedView.js',
    'components/ContactDetailedView/ContactDetailedView.js',
    'components/UserDetailedView/UserDetailedView.js',
    'components/AssistantDetailedView/AssistantDetailedView.js',
    'components/SkillDetailedView/Sections.js',
]

const NOTE_SECTIONS = 'components/NotesView/NotesDV/Sections.js'

const readSource = relativePath => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')

const chatBoardElements = source =>
    source
        .split('<ChatBoard')
        .slice(1)
        .map(chunk => chunk.slice(0, chunk.indexOf('/>')))

describe('chat fullscreen wiring', () => {
    test.each(CHAT_TAB_FILES)('%s hands its fullscreen state to ChatBoard', relativePath => {
        const elements = chatBoardElements(readSource(relativePath))

        expect(elements).toHaveLength(1)
        expect(elements[0]).toMatch(/isFullscreen=/)
        expect(elements[0]).toMatch(/setFullscreen=/)
    })

    // The note DV renders two chats: the chat tab, which owns the whole content area, and the
    // side chat beside the editor, which is a panel and must never take the note's chrome away.
    test('the note DV wires only its chat tab, not the editor side chat', () => {
        const elements = chatBoardElements(readSource(NOTE_SECTIONS))

        expect(elements).toHaveLength(2)
        expect(elements.filter(element => element.includes('setFullscreen='))).toHaveLength(1)
    })
})
