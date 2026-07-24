import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import MediaPlayer from '../../../../UIComponents/MediaPlayer'
import LoadingImageVideo from './LoadingImageVideo'
import { LOADING_MODE } from '../../textInputHelper'

export default function CustomVideoContainer({ uri, isLoading, editorId }) {
    const projectId = useSelector(state => state.quillTextInputProjectIdsByEditorId[editorId])

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
