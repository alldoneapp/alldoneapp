import React, { useCallback, useImperativeHandle, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { checkIsLimitedByTraffic } from '../Premium/PremiumHelper'
import { eventContainsFiles, getDroppedFiles } from '../Feeds/CommentsTextInput/attachmentFileUtils'
import { isArtifactUploadTooLarge, uploadArtifactFiles } from '../../utils/backends/Artifacts/artifactsFirestore'

// Uploading into the artifacts list. New files become one artifact each (most artifacts are a
// single self-contained HTML file or document); files picked for an existing artifact become one
// new version of it together.

export function getArtifactUploadErrorMessage(error) {
    if (!error) return ''
    if (error.code === 'too-large') return translate('Artifact upload too large')
    if (error.code === 'offline') return translate('Artifact upload needs internet')
    return translate('Artifact upload failed')
}

export function useArtifactUploader({ projectId, artifactId = null, onUploaded }) {
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState(null)

    const uploadFiles = useCallback(
        async files => {
            const fileList = Array.from(files || [])
            if (fileList.length === 0 || uploading) return
            if (checkIsLimitedByTraffic(projectId)) return
            setError(null)

            const batches = artifactId ? [fileList] : fileList.map(file => [file])
            if (batches.some(batch => isArtifactUploadTooLarge(batch))) {
                const tooLarge = new Error('too large')
                tooLarge.code = 'too-large'
                setError(tooLarge)
                return
            }

            setUploading(true)
            try {
                for (const batch of batches) {
                    const result = await uploadArtifactFiles({ projectId, artifactId, files: batch })
                    if (result && onUploaded) onUploaded(result)
                }
            } catch (uploadError) {
                console.warn('[artifacts] Upload failed', { projectId, artifactId, error: uploadError })
                setError(uploadError)
            } finally {
                setUploading(false)
            }
        },
        [projectId, artifactId, uploading, onUploaded]
    )

    return { uploading, error, uploadFiles, clearError: () => setError(null) }
}

// A hidden <input type="file">. The parent opens it through the ref.
export const ArtifactFileInput = React.forwardRef(function ArtifactFileInput({ onFiles, multiple = true }, ref) {
    const inputRef = useRef(null)

    useImperativeHandle(ref, () => ({
        open: () => inputRef.current?.click?.(),
    }))

    if (Platform.OS !== 'web') return null
    return (
        <input
            ref={inputRef}
            type="file"
            multiple={multiple}
            style={{ display: 'none' }}
            data-testid="artifact-file-input"
            onChange={event => {
                const files = Array.from(event.target.files || [])
                // Reset, so picking the same file again still fires onChange.
                event.target.value = ''
                if (files.length) onFiles(files)
            }}
        />
    )
})

// Capture phase for the same reason as AttachmentDropZone (AT-2441): a drop target further down
// must not be able to claim the files first. Only drags carrying files are claimed.
export function ArtifactDropZone({ children, disabled, onFiles, testID }) {
    const [dragging, setDragging] = useState(false)
    const depth = useRef(0)

    if (Platform.OS !== 'web') return <View>{children}</View>

    const claim = event => {
        event.preventDefault()
        event.stopPropagation()
        const dataTransfer = event.dataTransfer || event.nativeEvent?.dataTransfer
        if (dataTransfer) dataTransfer.dropEffect = 'copy'
    }

    return (
        <div
            data-testid={testID}
            style={{ position: 'relative' }}
            onDragEnter={event => {
                if (!eventContainsFiles(event)) return
                claim(event)
                if (disabled) return
                depth.current += 1
                setDragging(true)
            }}
            onDragOver={event => {
                if (eventContainsFiles(event)) claim(event)
            }}
            onDragLeave={event => {
                if (!dragging) return
                claim(event)
                depth.current = Math.max(0, depth.current - 1)
                if (depth.current === 0) setDragging(false)
            }}
            onDropCapture={event => {
                const files = getDroppedFiles(event)
                if (files.length === 0) return
                claim(event)
                depth.current = 0
                setDragging(false)
                if (!disabled) onFiles(files)
            }}
        >
            {children}
            {dragging && (
                <View pointerEvents="none" style={localStyles.dropFeedback} testID="artifact-drop-feedback">
                    <Text style={localStyles.dropFeedbackText}>{translate('Drop files to add them as artifacts')}</Text>
                </View>
            )}
        </div>
    )
}

export function ArtifactUploadStatus({ uploading, error }) {
    if (!uploading && !error) return null
    return (
        <Text
            testID={uploading ? 'artifact-uploading' : 'artifact-upload-error'}
            style={[localStyles.status, error && !uploading && localStyles.statusError]}
        >
            {uploading ? translate('Uploading artifact') : getArtifactUploadErrorMessage(error)}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    dropFeedback: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: colors.Primary100,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
    },
    dropFeedbackText: {
        ...styles.subtitle2,
        color: colors.Primary100,
    },
    status: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 8,
    },
    statusError: {
        color: colors.UtilityRed200,
    },
})
