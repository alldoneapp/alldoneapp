import Quill from 'quill'
import {
    loadMentionsData,
    loadQuill,
    resetMentionsData,
    onChangeSelection,
    handleTextChangeForMentions,
    showMentionPopup,
    mentionText,
    getSelection,
    insertNormalMention,
} from './mentionsHelper'

jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    getElementOffset: () => ({ top: 0, left: 0 }),
    NOT_USER_MENTIONED: 'not-user',
    MENTION_MODAL_WIDTH: 300,
    MENTION_MODAL_RIGHT_MARGIN: 16,
}))
jest.mock('../../../../redux/store', () => ({ getState: () => ({ loggedUser: { uid: 'user' } }) }))
jest.mock('../../../../utils/LinkingHelper', () => ({}))
jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({}))
jest.mock('../../../../utils/backends/Contacts/contactsFirestore', () => ({}))
jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({}))
const Embed = Quill.import('blots/embed')
class TestMention extends Embed {
    static create(value) {
        const node = super.create()
        node.setAttribute('data-text', value.text)
        node.textContent = value.text
        return node
    }
    static value(node) {
        return { text: node.getAttribute('data-text') }
    }
}
TestMention.blotName = 'mention'
TestMention.tagName = 'span'
Quill.register(TestMention, true)
let editor
let node
beforeEach(() => {
    node = document.createElement('div')
    document.body.appendChild(node)
    editor = new Quill(node, { modules: { toolbar: false } })
    editor.root.classList.add('ql-editor-test')
    editor.getBounds = jest.fn(() => ({ bottom: 24, left: 10 }))
    loadQuill(editor)
    loadMentionsData('test', { current: editor }, 'project')
})
afterEach(() => {
    resetMentionsData()
    node.remove()
})
it('tracks ordinary cursor movements without any bounds/layout reads or whole-document text extraction', () => {
    editor.setText('x'.repeat(100000))
    const contents = jest.spyOn(editor, 'getContents')
    for (const index of [1, 20000, 99999]) onChangeSelection({ index, length: 0 })
    expect(getSelection()).toEqual({ index: 99999, length: 0 })
    expect(editor.getBounds).not.toHaveBeenCalled()
    expect(contents.mock.calls.every(([, length]) => length <= 2)).toBe(true)
})
it('opens, edits and converts a mention while preserving cursor positions around other embeds', () => {
    editor.setContents([{ insert: { mention: { text: 'existing' } } }, { insert: ' @Al\n' }])
    onChangeSelection({ index: 3, length: 0 })
    expect(showMentionPopup).toBe(true)
    expect(mentionText).toBe('Al')
    const change = editor.insertText(5, 'ice', 'user')
    handleTextChangeForMentions(change)
    expect(mentionText).toBe('Alice')
    onChangeSelection({ index: 8, length: 0 })
    insertNormalMention()
    expect(showMentionPopup).toBe(false)
    expect(editor.getContents().ops.filter(op => op.insert?.mention)).toHaveLength(2)
    expect(editor.getContents().ops.some(op => op.insert?.mention?.text === 'Alice')).toBe(true)
})
it('transforms an open mention through a remote prefix insertion and closes if @ is deleted', () => {
    editor.setText(' @Name\n')
    onChangeSelection({ index: 2, length: 0 })
    handleTextChangeForMentions(editor.insertText(0, 'remote ', 'api'))
    expect(mentionText).toBe('Name')
    handleTextChangeForMentions(editor.deleteText(8, 1, 'api'))
    expect(showMentionPopup).toBe(false)
})
