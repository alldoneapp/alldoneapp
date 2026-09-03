import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, SafeAreaView, Text, TouchableOpacity, View } from 'react-native'
import firebase from 'firebase/compat/app'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { reverseUndoAction } from '../../utils/undo/undoActions'
import undoActionBarStyles from './undoActionBarStyles'
import useUndoActionBarMotion, { UNDO_DISPLAY_TIME_MS } from './undoActionBarMotion'

// AT-2503 — one constant for the auto-hide timer below and for the countdown line that draws it, so
// the bar can never empty at a different moment than the banner actually leaves.
const DISPLAY_TIME_MS = UNDO_DISPLAY_TIME_MS

const isTypingTarget = target => {
    if (!target) return false
    const tagName = String(target.tagName || '').toLowerCase()
    return tagName === 'input' || tagName === 'textarea' || target.isContentEditable
}

export default function UndoActionBar() {
    const loggedIn = useSelector(state => state.loggedIn)
    const userId = useSelector(state => state.loggedUser?.uid)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [action, setAction] = useState(null)
    const [actions, setActions] = useState([])
    const [visible, setVisible] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const mountedAt = useRef(Date.now())
    const busyRef = useRef(false)

    useEffect(() => {
        if (!loggedIn || !userId) return undefined

        return firebase
            .firestore()
            .collection(`users/${userId}/undoActions`)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .onSnapshot(snapshot => {
                const nextActions = snapshot.docs.map(document => document.data())
                setActions(nextActions)
                if (nextActions.length === 0) {
                    setAction(null)
                    return
                }
                const nextAction = [...nextActions].sort(
                    (first, second) => second.lastChangedAt - first.lastChangedAt
                )[0]
                setAction(nextAction)
                setError('')
                if (
                    nextAction.createdAt >= mountedAt.current - 1000 ||
                    nextAction.lastChangedAt >= mountedAt.current - 1000
                ) {
                    setVisible(true)
                }
            })
    }, [loggedIn, userId])

    useEffect(() => {
        if (!visible || busy) return undefined
        const timer = setTimeout(() => setVisible(false), DISPLAY_TIME_MS)
        return () => clearTimeout(timer)
    }, [visible, busy, action?.actionId, action?.status])

    const reverse = async (targetAction, direction) => {
        if (!targetAction || busyRef.current) return
        busyRef.current = true
        setBusy(true)
        setError('')
        setVisible(true)
        try {
            await reverseUndoAction(targetAction.actionId, direction)
        } catch (reverseError) {
            const message = reverseError?.message || translate('Could not reverse action')
            setError(message.replace(/^.*?:\s*/, ''))
        } finally {
            busyRef.current = false
            setBusy(false)
        }
    }

    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onKeyDown = event => {
            const undoShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z'
            if (!undoShortcut || isTypingTarget(event.target) || busy) return
            const targetAction = event.shiftKey
                ? actions.find(candidate => candidate.status === 'undone')
                : actions.find(candidate => candidate.status === 'applied')
            if (!targetAction) return
            event.preventDefault()
            reverse(targetAction, event.shiftKey ? 'redo' : 'undo')
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [actions, busy])

    /*
     * AT-2503 — the banner can no longer unmount the instant `visible` goes false: there would be
     * nothing left on screen to animate out. `motion.rendered` stays true for the length of the
     * exit and the hook owns that lifecycle. Under reduced motion (and in jest) it tracks `visible`
     * synchronously, so a dismiss still removes the banner in the very same commit as the press.
     *
     * The hook is called before the early return because hooks cannot be conditional; every input
     * it takes tolerates a null `action`.
     */
    const motion = useUndoActionBarMotion({
        visible,
        // A status flip (Undo → "Undone: …") or an error replacing the label is a content change,
        // which is a nudge rather than a re-entry.
        contentKey: `${action?.actionId || ''}|${action?.status || ''}|${error}`,
        // Deliberately the same inputs as the auto-hide effect above, so the line refills exactly
        // when that timer restarts.
        countdownKey: `${action?.actionId || ''}|${action?.status || ''}`,
        countdownActive: visible && !busy,
    })

    if (!motion.rendered || !action) return null

    const isUndone = action.status === 'undone'
    const message = error ? error : isUndone ? `${translate('Undone')}: ${action.label}` : action.label
    const stopPropagation = event => event?.stopPropagation?.()

    return (
        <SafeAreaView pointerEvents="box-none" style={undoActionBarStyles.overlay}>
            <View
                pointerEvents="box-none"
                style={[undoActionBarStyles.viewport, mobile && undoActionBarStyles.mobileViewport]}
            >
                <Animated.View
                    style={[undoActionBarStyles.container, motion.containerStyle]}
                    accessibilityLiveRegion="polite"
                    // A banner on its way out must not swallow a click meant for the app behind it.
                    pointerEvents={motion.exiting ? 'none' : 'auto'}
                    // Which of the four is playing, as a real `data-undo-animation` attribute
                    // (react-native-web renders `dataSet` to data-*). It is how the browser harness
                    // checks that an exit mirrors its entry, and it makes "which one was that?"
                    // answerable from devtools instead of by re-reading the picker.
                    dataSet={{ undoAnimation: motion.variantId, undoAnimationPhase: motion.phase }}
                    testID="undo-action-bar-container"
                >
                    <TouchableOpacity
                        activeOpacity={1}
                        style={localStyles.dismissArea}
                        onPress={() => setVisible(false)}
                        accessibilityRole="button"
                        accessibilityLabel={`${translate('Dismiss')}: ${message}`}
                        testID="undo-action-bar"
                    />
                    <Animated.Text
                        pointerEvents="none"
                        numberOfLines={2}
                        style={[styles.body2, localStyles.message, motion.messageStyle]}
                    >
                        {message}
                    </Animated.Text>
                    {busy ? (
                        <ActivityIndicator pointerEvents="none" color={colors.UtilityBlue200} size="small" />
                    ) : error ? (
                        <TouchableOpacity
                            onPress={event => {
                                stopPropagation(event)
                                setVisible(false)
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={translate('Dismiss')}
                        >
                            <Text style={[styles.button, localStyles.action]}>{translate('Dismiss')}</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            onPress={event => {
                                stopPropagation(event)
                                reverse(action, isUndone ? 'redo' : 'undo')
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={translate(isUndone ? 'Redo' : 'Undo')}
                            testID="undo-action-button"
                        >
                            <Text style={[styles.button, localStyles.action]}>
                                {translate(isUndone ? 'Redo' : 'Undo')}
                            </Text>
                        </TouchableOpacity>
                    )}
                    {motion.showCountdown && (
                        <Animated.View
                            pointerEvents="none"
                            /*
                             * Purely temporal decoration: the remaining time is not something a
                             * screen reader should have to hear ticking away, and the live region
                             * on the card already announces everything the banner has to say.
                             *
                             * `aria-hidden`, NOT the legacy `accessibilityElementsHidden` /
                             * `importantForAccessibility` pair — react-native-web 0.21 forwards
                             * neither of those (see the same note in `IntegrationsLoadingRegion`),
                             * so they would read as an accessibility fix and do nothing at all.
                             */
                            aria-hidden={true}
                            style={[localStyles.countdown, motion.countdownStyle]}
                            testID="undo-action-countdown"
                        />
                    )}
                </Animated.View>
            </View>
        </SafeAreaView>
    )
}

const localStyles = undoActionBarStyles
