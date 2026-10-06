import ReactQuill from 'react-quill-new'
import { installTaskTagSelectionCollapse } from './taskTagSelection'

/**
 * The note is uncontrolled and owned by Yjs. Its change consumer needs the
 * incremental Delta, never HTML. ReactQuill 3.8.3 otherwise serializes the whole
 * document twice per event (including silent/collaboration events).
 * Keep its selection/focus lifecycle and editor API, bypass only serialization.
 * Other editors, clipboard conversion and explicit getSemanticHTML stay intact.
 */
export default class NoteQuill extends ReactQuill {
    constructor(props) {
        super(props)
        const onEditorChange = this.onEditorChange
        this.onEditorChange = (eventName, delta, oldDelta, source) => {
            if (eventName !== 'text-change') return onEditorChange(eventName, delta, oldDelta, source)
            if (this.editor && delta.ops.length) {
                this.props.onChange?.(null, delta, source, this.unprivilegedEditor, oldDelta)
            }
        }
    }

    validateProps(props) {
        super.validateProps(props)
        if ('value' in props) throw new Error('NoteQuill content must be owned by Yjs, not a controlled value')
    }

    createEditor(element, config) {
        const editor = super.createEditor(element, config)
        installTaskTagSelectionCollapse(editor)
        return editor
    }
}
