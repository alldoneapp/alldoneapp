/**
 * @jest-environment jsdom
 *
 * AT-2227. The image embed resolves its project from the per-editor redux map. When that
 * lookup came back empty the container rendered <LoadingImageVideo /> — a full-width grey
 * placeholder with a spinner — and, because nothing ever filled the map in, it stayed
 * there for the life of the popup even though the file had uploaded fine.
 */
import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('./CustomImage', () => 'CustomImage')
jest.mock('./LoadingImageVideo', () => 'LoadingImageVideo')

let mockState
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
// textInputHelper pulls in the whole backend bridge; only the two mode flags matter here.
jest.mock('../../textInputHelper', () => ({ LOADING_MODE: '0', LOADED_MODE: '1' }))

import CustomImageContainer from './CustomImageContainer'
import { LOADED_MODE, LOADING_MODE } from '../../textInputHelper'

const render = (props, reduxState) => {
    mockState = { quillTextInputProjectIdsByEditorId: {}, quillEditorProjectId: '', ...reduxState }
    return renderer.create(<CustomImageContainer uri="blob:img" resizedUri="blob:img" maxWidth={400} {...props} />).root
}

describe('CustomImageContainer', () => {
    it('renders the image once the editor project is known', () => {
        const root = render(
            { editorId: 'editor-1', isLoading: LOADED_MODE },
            { quillTextInputProjectIdsByEditorId: { 'editor-1': 'project-1' } }
        )
        expect(root.findAllByType('LoadingImageVideo')).toHaveLength(0)
        expect(root.findByType('CustomImage').props).toEqual(
            expect.objectContaining({ projectId: 'project-1', resizedUri: 'blob:img', maxWidth: 400 })
        )
    })

    it('renders the image for a freshly dropped file, which carries no loading flag', () => {
        const root = render(
            { editorId: 'editor-1', isLoading: undefined },
            { quillTextInputProjectIdsByEditorId: { 'editor-1': 'project-1' } }
        )
        expect(root.findAllByType('LoadingImageVideo')).toHaveLength(0)
        expect(root.findAllByType('CustomImage')).toHaveLength(1)
    })

    it('still shows the loading placeholder while an upload is genuinely in flight', () => {
        const root = render(
            { editorId: 'editor-1', isLoading: LOADING_MODE },
            { quillTextInputProjectIdsByEditorId: { 'editor-1': 'project-1' } }
        )
        expect(root.findAllByType('LoadingImageVideo')).toHaveLength(1)
        expect(root.findAllByType('CustomImage')).toHaveLength(0)
    })

    it('falls back to the active editor project instead of spinning forever when the editorId is unresolvable', () => {
        const root = render({ editorId: undefined, isLoading: undefined }, { quillEditorProjectId: 'project-1' })
        expect(root.findAllByType('LoadingImageVideo')).toHaveLength(0)
        expect(root.findByType('CustomImage').props.projectId).toBe('project-1')
    })

    it('prefers the per-editor project over the active-editor fallback', () => {
        const root = render(
            { editorId: 'editor-1', isLoading: undefined },
            { quillTextInputProjectIdsByEditorId: { 'editor-1': 'project-1' }, quillEditorProjectId: 'project-2' }
        )
        expect(root.findByType('CustomImage').props.projectId).toBe('project-1')
    })
})
