import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import CustomImage from './CustomImage'
import LoadingImageVideo from './LoadingImageVideo'
import { LOADING_MODE } from '../../textInputHelper'

export default function CustomImageContainer({ uri, resizedUri, isLoading, maxWidth, editorId }) {
    const projectId = useSelector(state => state.quillTextInputProjectIdsByEditorId[editorId])

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
