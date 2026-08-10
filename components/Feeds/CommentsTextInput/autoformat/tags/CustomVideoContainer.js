import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import MediaPlayer from '../../../../UIComponents/MediaPlayer'
import LoadingImageVideo from './LoadingImageVideo'
import { LOADING_MODE } from '../../textInputHelper'

export default function CustomVideoContainer({ uri, isLoading, editorId }) {
    // Same fallback as CustomImageContainer (AT-2227): a missing per-editor entry must not
    // strand the embed on the loading placeholder.
    const projectId = useSelector(
        state => state.quillTextInputProjectIdsByEditorId[editorId] || state.quillEditorProjectId
    )

    return (
        <View>
            {isLoading === LOADING_MODE || !projectId ? (
                <LoadingImageVideo />
            ) : (
                <MediaPlayer projectId={projectId} src={uri} />
            )}
        </View>
    )
}
