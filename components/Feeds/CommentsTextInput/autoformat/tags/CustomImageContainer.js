import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import CustomImage from './CustomImage'
import LoadingImageVideo from './LoadingImageVideo'
import { LOADING_MODE } from '../../textInputHelper'

export default function CustomImageContainer({ uri, resizedUri, isLoading, maxWidth, editorId }) {
    // AT-2227: an unresolvable editorId used to pin this on the loading placeholder
    // forever. The per-editor map stays authoritative (it carries the right project for
    // traffic accounting), but fall back to the active editor's project so a missing entry
    // degrades to "show the image" instead of "spin until the popup is closed".
    const projectId = useSelector(
        state => state.quillTextInputProjectIdsByEditorId[editorId] || state.quillEditorProjectId
    )

    return (
        <View>
            {isLoading === LOADING_MODE || !projectId ? (
                <LoadingImageVideo />
            ) : (
                <CustomImage projectId={projectId} uri={uri} resizedUri={resizedUri} maxWidth={maxWidth} />
            )}
        </View>
    )
}
