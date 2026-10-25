// AT-2363: wraps a task row so files dragged from the OS land in that task's description.
//
// Deliberately modelled on `AttachmentDropZone` (the chat/description editor drop target) rather
// than sharing it: that component's whole contract is "insert into the Quill editor I was handed",
// and a task row has no editor. What IS shared is the behaviour — same drag-depth tracking, same
// `dropEffect`, same highlight overlay idiom, same 50 MB gate and traffic-quota check.
//
// This cannot collide with task reordering: @hello-pangea/dnd is pointer-sensor based and sets
// `draggable: false` + preventDefault on `dragstart` for the row, so an OS file drag never enters
// its state machine. Reordering additionally only exists in organize mode, which is excluded here.

import React, { useCallback, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'

import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'
import Spinner from '../../../UIComponents/Spinner'
import { eventContainsFiles, getDroppedFiles } from '../../../Feeds/CommentsTextInput/attachmentFileUtils'
import { addDroppedFilesToTaskDescription } from './taskFileDropHelper'

const WEB_CONTAINER_STYLE = {
    display: 'contents',
}

export default function TaskFileDropZone({ children, disabled, projectId, task }) {
    const [isDraggingFiles, setIsDraggingFiles] = useState(false)
    const [pendingUploads, setPendingUploads] = useState(0)
    const dragDepth = useRef(0)
    const enabled = Platform.OS === 'web' && !disabled && !!task

    // A file dropped on a page the browser owns navigates away from the app and loses unsaved
    // state, so preventDefault runs even for a drag this row will not act on.
    //
    // stopPropagation, however, runs ONLY when this row owns the drop. A task row is rendered
    // inside the rich comment popup (as a read-only header), and that popup has its own
    // AttachmentDropZone above us — swallowing the event unconditionally would silently break
    // dropping a file into that comment.
    const preventBrowserDrop = event => {
        event.preventDefault()
        if (enabled) event.stopPropagation()
        const dataTransfer = event.dataTransfer || event.nativeEvent?.dataTransfer
        if (dataTransfer) dataTransfer.dropEffect = enabled ? 'copy' : 'none'
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

    // Deliberately keyed on our own depth counter rather than on `eventContainsFiles`: a browser
    // that reports no `types` on dragleave would otherwise never let the counter reach zero and
    // the overlay would stay on the row forever. If we never counted an enter there is nothing to
    // undo, so this is also a no-op for unrelated drags.
    const onDragLeave = event => {
        if (dragDepth.current === 0) return
        preventBrowserDrop(event)
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setIsDraggingFiles(false)
    }

    const onDrop = useCallback(
        async event => {
            if (!eventContainsFiles(event)) return
            preventBrowserDrop(event)
            dragDepth.current = 0
            setIsDraggingFiles(false)

            const files = getDroppedFiles(event)
            if (files.length === 0 || !enabled || checkIsLimitedByTraffic(projectId)) return

            setPendingUploads(count => count + 1)
            try {
                const { failedCount } = await addDroppedFilesToTaskDescription({ projectId, task, files })
                if (failedCount > 0) alert(translate('Task attachment upload failed'))
            } catch (error) {
                alert(translate('Task attachment upload failed'))
            } finally {
                setPendingUploads(count => Math.max(0, count - 1))
            }
        },
        [enabled, projectId, task]
    )

    const isUploading = pendingUploads > 0
    const showFeedback = isDraggingFiles || isUploading

    const content = (
        <View style={localStyles.container}>
            {children}
            {showFeedback && (
                // pointerEvents none: the overlay is feedback only and must never eat a click on
                // the row underneath, least of all during a multi-second upload.
                //
                // The highlight border lives on this absolutely-positioned overlay rather than on
                // the row container on purpose: a border on the container would add 2px to the
                // row's box and make every row below it jump the moment a file crosses it.
                <View
                    pointerEvents="none"
                    style={[localStyles.feedback, isDraggingFiles && localStyles.feedbackDragging]}
                    testID="task-file-drop-feedback"
                    accessibilityLiveRegion="polite"
                >
                    {isUploading && <Spinner containerSize={24} spinnerSize={16} />}
                    <Text style={localStyles.feedbackText}>
                        {translate(isUploading ? 'Adding files to description' : 'Drop files to add to description')}
                    </Text>
                </View>
            )}
        </View>
    )

    if (Platform.OS !== 'web') return content

    return (
        <div
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
    feedback: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        backgroundColor: 'rgba(240, 246, 255, 0.94)',
    },
    feedbackDragging: {
        borderColor: colors.UtilityBlue125,
        borderWidth: 2,
    },
    feedbackText: {
        color: colors.UtilityBlue125,
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 8,
    },
})
