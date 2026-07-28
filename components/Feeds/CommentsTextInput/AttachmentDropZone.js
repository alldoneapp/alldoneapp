import React, { useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'

import { translate } from '../../../i18n/TranslationService'
import { colors } from '../../styles/global'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'
import { addFilesAsAttachments } from './attachmentFileUtils'
import { insertAttachmentInsideEditor } from './textInputHelper'

const WEB_CONTAINER_STYLE = {
    display: 'contents',
}

export const getDroppedFiles = event => {
    const dataTransfer = event?.dataTransfer || event?.nativeEvent?.dataTransfer
    return Array.from(dataTransfer?.files || [])
}

export const eventContainsFiles = event => {
    const dataTransfer = event?.dataTransfer || event?.nativeEvent?.dataTransfer
    return Array.from(dataTransfer?.types || []).includes('Files')
}

export const addDroppedFilesToEditor = ({ files, editor, inputCursorIndex = 0, setInputCursorIndex }) => {
    let nextCursorIndex = inputCursorIndex
    const addedFiles = addFilesAsAttachments(files, (name, uri) => {
        // Use the regular editor embed so save/submit uses the existing upload and persistence path.
        insertAttachmentInsideEditor(nextCursorIndex, editor, name, uri)
        nextCursorIndex += 3
    })

    if (addedFiles.length > 0) {
        setInputCursorIndex?.(nextCursorIndex)
        editor?.focus?.()
    }

    return addedFiles
}

export default function AttachmentDropZone({
    children,
    disabled,
    editor,
    inputCursorIndex,
    projectId,
    setInputCursorIndex,
    style,
    testID,
}) {
    const [isDraggingFiles, setIsDraggingFiles] = useState(false)
    const dragDepth = useRef(0)
    const enabled = Platform.OS === 'web' && !disabled && !!editor

    const preventBrowserDrop = event => {
        event.preventDefault()
        event.stopPropagation()
        const dataTransfer = event.dataTransfer || event.nativeEvent?.dataTransfer
        if (dataTransfer) dataTransfer.dropEffect = 'copy'
    }

    const onDragEnter = event => {
        if (!eventContainsFiles(event)) return
        preventBrowserDrop(event)
        if (!enabled) return
        dragDepth.current += 1
        setIsDraggingFiles(true)
    }

    const onDragOver = event => {
        if (!eventContainsFiles(event)) return
        preventBrowserDrop(event)
    }

    const onDragLeave = event => {
        if (!enabled || !isDraggingFiles) return
        preventBrowserDrop(event)
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setIsDraggingFiles(false)
    }

    const onDrop = event => {
        const files = getDroppedFiles(event)
        if (files.length === 0) return
        preventBrowserDrop(event)
        dragDepth.current = 0
        setIsDraggingFiles(false)
        if (!enabled || checkIsLimitedByTraffic(projectId)) return
        addDroppedFilesToEditor({
            files,
            editor,
            inputCursorIndex,
            setInputCursorIndex,
        })
    }

    const content = (
        <View
            style={[localStyles.container, style, isDraggingFiles && localStyles.containerDragging]}
            testID={Platform.OS === 'web' ? undefined : testID}
        >
            {children}
            {isDraggingFiles && (
                <View pointerEvents="none" style={localStyles.feedback} testID="attachment-drop-feedback">
                    <Text style={localStyles.feedbackText}>{translate('Drop files to attach')}</Text>
                </View>
            )}
        </View>
    )

    if (Platform.OS !== 'web') return content

    return (
        <div
            data-testid={testID}
            style={WEB_CONTAINER_STYLE}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {content}
        </div>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'relative',
    },
    containerDragging: {
        borderColor: colors.UtilityBlue125,
        borderWidth: 2,
    },
    feedback: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        backgroundColor: 'rgba(240, 246, 255, 0.94)',
    },
    feedbackText: {
        color: colors.UtilityBlue125,
        fontSize: 14,
        fontWeight: '600',
    },
})
