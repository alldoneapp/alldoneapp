import React from 'react'
import MentionedCommentTag from '../../../../Tags/MentionedCommentTag'

const CommentTagFormatContainer = ({ projectId, parentObjectId, parentType, assistantId }) => {
    return (
        <MentionedCommentTag
            projectId={projectId}
            parentObjectId={parentObjectId}
            parentType={parentType}
            inTextInput={true}
            assistantId={assistantId}
        />
    )
}

export default CommentTagFormatContainer
