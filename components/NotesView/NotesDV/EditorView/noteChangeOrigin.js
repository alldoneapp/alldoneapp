// y-quill applies collaborator updates with its binding instance as source.
// API edits (image conversion, templates, mentions) are local too.
export const isRemoteEditorChange = (source, bindingInstance) =>
    !!bindingInstance && typeof source === 'object' && source === bindingInstance
