import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import WorkspaceOverlayLayer from '../UIComponents/WorkspaceOverlayLayer'
import MeetingReviewSheet from './MeetingReviewSheet'
import styles, { colors } from '../styles/global'
import { themed } from '../../Themes/colorMode'
import { translate } from '../../i18n/TranslationService'
import { MODAL_EDGE_GAP, MODAL_WIDTH_M } from '../styles/modals'
import useModalSizing from '../../hooks/useModalSizing'
import { getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import {
    finishCurrentMeetingReview,
    showMeetingReviewToast,
    startMeetingReviewQueueMode,
    startMeetingReviewSubscriptions,
    stopMeetingReviewSubscriptions,
    useMeetingReviewSelector,
} from '../../utils/meetingReview/meetingReviewStore'
import {
    applyMeetingReviewAction,
    getSeriesCategory,
    getStoredReview,
    resolveTaskMeetingCategory,
} from '../../utils/meetingReview/meetingReviewActions'
import { openMeetingTimeStatistics } from '../../utils/meetingReview/openMeetingTimeStatistics'
import { getMeetingReviewChipText } from './meetingReviewChipText'

const TOAST_MS = 5000

/**
 * AT-3137 — the one mount of the meeting rating sheet and its undo toast, next to the New Day
 * popup in AppContent. The task row that was ticked collapses and unmounts right after completion,
 * so the sheet cannot live in the row; rows (and the chip / detail section) push a request into the
 * meeting review store instead.
 *
 * Non-blocking by design: no scrim, the app stays usable, completing never waits for a rating.
 * Also attaches the private review listeners for the signed-in user.
 */
export default function MeetingReviewHost() {
    const uid = useSelector(state => state.loggedUser?.uid)
    const isAnonymous = useSelector(state => !!state.loggedUser?.isAnonymous)
    const current = useMeetingReviewSelector(state => state.queue[state.queue.length - 1] || null)
    const queueLength = useMeetingReviewSelector(state => state.queue.length)
    const queueMode = useMeetingReviewSelector(state => state.queueMode)
    const toast = useMeetingReviewSelector(state => state.toast)
    // Re-render when the stored data the sheet resolves from changes.
    const reviews = useMeetingReviewSelector(state => state.reviews)
    const seriesCategories = useMeetingReviewSelector(state => state.seriesCategories)
    const rules = useMeetingReviewSelector(state => state.rules)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const toastTimerRef = useRef(null)
    const { isSheet, safeAreaInsets } = useModalSizing()

    useEffect(() => {
        if (!uid || isAnonymous) return undefined
        startMeetingReviewSubscriptions(uid)
        return () => stopMeetingReviewSubscriptions()
    }, [uid, isAnonymous])

    useEffect(() => {
        clearTimeout(toastTimerRef.current)
        if (toast) toastTimerRef.current = setTimeout(() => showMeetingReviewToast(null), TOAST_MS)
        return () => clearTimeout(toastTimerRef.current)
    }, [toast?.id])

    useEffect(() => setError(''), [current?.task?.id])

    if (!uid || isAnonymous) return null

    const state = { reviews, seriesCategories, rules }
    const task = current ? { ...current.task, projectId: current.task.projectId || current.projectId } : null
    const review = task ? getStoredReview(task, state) : null
    const resolved = task ? resolveTaskMeetingCategory(task, state) : null

    const handleAction = async (action, { scope = null, duration = null } = {}) => {
        if (!task || saving) return
        setSaving(true)
        setError('')
        try {
            const result = await applyMeetingReviewAction({ uid, task, action, scope, duration })
            // "attended after all" brings the usefulness question back; everything else is done.
            if (action.type !== 'attended') finishCurrentMeetingReview()
            if (action.type === 'rate') {
                showMeetingReviewToast({
                    text: translate('Meeting rated toast', {
                        summary: getMeetingReviewChipText(result.review, resolveTaskMeetingCategory(task)),
                    }),
                    undo: result.undo,
                })
            }
        } catch (actionError) {
            console.error('[meetingReview] could not save', actionError)
            setError(translate('Meeting review save failed'))
        } finally {
            setSaving(false)
        }
    }

    const handleLater = () => {
        if (!task) return
        // First prompt: remember "skipped" so we do not ask again; editing later just closes.
        if (!current.isEdit) {
            applyMeetingReviewAction({ uid, task, action: { type: 'skip' } }).catch(skipError =>
                console.error('[meetingReview] could not store skip', skipError)
            )
        }
        finishCurrentMeetingReview()
    }

    return (
        <WorkspaceOverlayLayer>
            {task && (
                <View
                    pointerEvents="box-none"
                    style={[localStyles.anchor, isSheet ? localStyles.anchorSheet : localStyles.anchorDesktop]}
                >
                    <View
                        style={[
                            localStyles.container,
                            isSheet ? { paddingBottom: safeAreaInsets?.bottom || 0 } : localStyles.containerDesktop,
                        ]}
                    >
                        <MeetingReviewSheet
                            key={task.id}
                            task={task}
                            review={review}
                            resolved={resolved}
                            seriesCategory={getSeriesCategory(task, state)}
                            isEdit={!!current.isEdit}
                            queueRemaining={queueMode ? 0 : Math.max(0, queueLength - 1)}
                            saving={saving}
                            timeFormat={getTimeFormat()}
                            onAction={handleAction}
                            onLater={handleLater}
                            onStartQueue={startMeetingReviewQueueMode}
                            onOpenStatistics={() => {
                                finishCurrentMeetingReview()
                                openMeetingTimeStatistics()
                            }}
                        />
                        {!!error && (
                            <Text style={localStyles.error} testID="meeting-review-error">
                                {error}
                            </Text>
                        )}
                    </View>
                </View>
            )}
            {toast && !task && (
                <View pointerEvents="box-none" style={[localStyles.anchor, localStyles.anchorDesktop]}>
                    <View style={localStyles.toast} dataSet={{ adPopup: 'true' }} testID="meeting-review-toast">
                        <Text style={localStyles.toastText}>{toast.text}</Text>
                        {toast.undo && (
                            <TouchableOpacity
                                testID="meeting-review-undo"
                                onPress={() => {
                                    const undo = toast.undo
                                    showMeetingReviewToast(null)
                                    undo().catch(undoError => console.error('[meetingReview] undo failed', undoError))
                                }}
                            >
                                <Text style={localStyles.undo}>{translate('Undo')}</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            )}
        </WorkspaceOverlayLayer>
    )
}

const localStyles = StyleSheet.create({
    anchor: {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10000,
        alignItems: 'center',
    },
    anchorDesktop: {
        bottom: 24,
        paddingHorizontal: MODAL_EDGE_GAP,
    },
    anchorSheet: {
        bottom: 0,
    },
    container: {
        width: '100%',
    },
    containerDesktop: {
        maxWidth: MODAL_WIDTH_M + 80,
    },
    error: {
        ...styles.caption1,
        color: colors.UtilityRed200,
        backgroundColor: colors.Surface,
        padding: 8,
    },
    toast: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: themed.PopupShadow,
        maxWidth: MODAL_WIDTH_M,
    },
    toastText: {
        ...styles.body2,
        color: '#ffffff',
        flexShrink: 1,
    },
    undo: {
        ...styles.subtitle2,
        color: colors.UtilityBlue200,
    },
})
