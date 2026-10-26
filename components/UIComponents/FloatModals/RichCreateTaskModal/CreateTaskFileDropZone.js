import React, { useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'

import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'
import { eventContainsFiles, getDroppedFiles } from '../../../Feeds/CommentsTextInput/attachmentFileUtils'

export default function CreateTaskFileDropZone({
    children,
    onFilesDropped,
    // AT-2875: the inline "Add new task" line reuses this zone, where a drop opens the popup
    // rather than adding to a description, so the hint and test id are configurable.
    label = 'Drop files to add to description',
    testID = 'create-task-file-drop-zone',
    disabled = false,
}) {
    const [dragging, setDragging] = useState(false)
    const dragDepth = useRef(0)

    if (Platform.OS !== 'web') return children

    // `disabled` only stops claiming drags. The wrapper stays mounted either way, so toggling it
    // never remounts (and so never resets) the children it wraps.

    const claimFileDrag = event => {
        event.preventDefault()
        event.stopPropagation()
        const dataTransfer = event.dataTransfer || event.nativeEvent?.dataTransfer
        if (dataTransfer) dataTransfer.dropEffect = 'copy'
    }

    const onDragEnter = event => {
        if (disabled || !eventContainsFiles(event)) return
        claimFileDrag(event)
        dragDepth.current += 1
        setDragging(true)
    }

    const onDragOver = event => {
        if (!disabled && eventContainsFiles(event)) claimFileDrag(event)
    }

    const onDragLeave = event => {
        if (dragDepth.current === 0) return
        claimFileDrag(event)
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
    }

    // Quill's uploader listens on the title editor itself. Claim file drops in capture so it
    // cannot insert a base64 image into the task NAME before the popup sees the drop.
    const onDrop = event => {
        if (disabled) return
        const files = getDroppedFiles(event)
        if (files.length === 0) return
        claimFileDrag(event)
        dragDepth.current = 0
        setDragging(false)
        onFilesDropped(files)
    }

    return (
        <div
            data-testid={testID}
            style={{ display: 'contents' }}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDropCapture={onDrop}
        >
            <View style={localStyles.container}>
                {children}
                {dragging && (
                    <View pointerEvents="none" style={localStyles.feedback} testID="create-task-file-drop-feedback">
                        <Text style={localStyles.feedbackText}>{translate(label)}</Text>
                    </View>
                )}
            </View>
        </div>
    )
}

const localStyles = StyleSheet.create({
    container: { position: 'relative' },
    feedback: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderColor: colors.UtilityBlue125,
        borderWidth: 2,
        borderRadius: 4,
        backgroundColor: 'rgba(240, 246, 255, 0.94)',
    },
    feedbackText: { color: colors.UtilityBlue125, fontSize: 14, fontWeight: '600' },
})
