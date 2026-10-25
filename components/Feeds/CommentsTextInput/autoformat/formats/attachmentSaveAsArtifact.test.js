/**
 * @jest-environment jsdom
 *
 * "Save as artifact" inside a note: the REAL attachment blot inside a REAL quill 2 renders the REAL
 * chip, which offers the action only for a file uploaded into a note, and resolves the note's
 * project from the editor registry because the blot itself is created without one.
 */
let mockState

jest.mock('../../../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockState,
        subscribe: () => () => {},
        dispatch: () => {},
    },
}))
jest.mock('../../CustomTextInput3', () => ({ quillTextInputProjectIds: {} }))
jest.mock('../../../../Premium/PremiumHelper', () => ({ checkIsLimitedByTraffic: () => false }))
jest.mock('../../../../../utils/backends/Artifacts/artifactsFirestore', () => ({ saveAttachmentAsArtifact: jest.fn() }))

import Quill from 'quill'

import Attachment from './attachment'

Quill.register({ 'formats/attachment': Attachment }, true)

const noteUri = `https://firebasestorage.googleapis.com/v0/b/bucket/o/${encodeURIComponent(
    'notesAttachments/24102026/abc/plan.pdf'
)}?alt=media&token=t1`
const commentUri = `https://firebasestorage.googleapis.com/v0/b/bucket/o/${encodeURIComponent(
    'feedAttachments/24102026/abc/draft.pdf'
)}?alt=media&token=t2`

function buildEditor() {
    const node = document.createElement('div')
    document.body.appendChild(node)
    return new Quill(node, { modules: { toolbar: false } })
}

const saveButtons = quill => quill.root.querySelectorAll('[data-testid="save-attachment-as-artifact"]')

beforeEach(() => {
    mockState = {
        virtualQuillLoaded: false,
        smallScreenNavigation: false,
        isMiddleScreen: false,
        loggedUser: { uid: 'owner' },
        quillTextInputProjectIdsByEditorId: { 'note-1': 'project-a' },
    }
})

afterEach(() => {
    document.body.innerHTML = ''
})

it("offers the action on a note's own attachment, using the note's project", () => {
    const quill = buildEditor()
    quill.insertEmbed(0, 'attachment', { text: 'plan.pdf', uri: noteUri, editorId: 'note-1' }, 'api')
    expect(saveButtons(quill)).toHaveLength(1)
})

it('offers nothing on a comment draft, or when the project cannot be resolved', () => {
    const quill = buildEditor()
    quill.insertEmbed(0, 'attachment', { text: 'draft.pdf', uri: commentUri, editorId: 'note-1' }, 'api')
    quill.insertEmbed(1, 'attachment', { text: 'plan.pdf', uri: noteUri, editorId: 'unknown-editor' }, 'api')
    expect(saveButtons(quill)).toHaveLength(0)
})
