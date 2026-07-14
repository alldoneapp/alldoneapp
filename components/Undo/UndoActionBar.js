import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { firebase } from '@firebase/app'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { reverseUndoAction } from '../../utils/undo/undoActions'

const DISPLAY_TIME_MS = 10000

const isTypingTarget = target => {
    if (!target) return false
    const tagName = String(target.tagName || '').toLowerCase()
    return tagName === 'input' || tagName === 'textarea' || target.isContentEditable
}

export default function UndoActionBar() {
    const loggedIn = useSelector(state => state.loggedIn)
    const userId = useSelector(state => state.loggedUser?.uid)
    const [action, setAction] = useState(null)
    const [actions, setActions] = useState([])
    const [visible, setVisible] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const mountedAt = useRef(Date.now())

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
        if (!targetAction || busy) return
        setBusy(true)
        setError('')
        setVisible(true)
        try {
            await reverseUndoAction(targetAction.actionId, direction)
        } catch (reverseError) {
            const message = reverseError?.message || translate('Could not reverse action')
            setError(message.replace(/^.*?:\s*/, ''))
        } finally {
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

    if (!visible || !action) return null

    const isUndone = action.status === 'undone'
    const message = error ? error : isUndone ? `${translate('Undone')}: ${action.label}` : action.label

    return (
        <View pointerEvents="box-none" style={localStyles.overlay}>
            <View style={localStyles.container} accessibilityLiveRegion="polite">
                <Text numberOfLines={2} style={[styles.body2, localStyles.message]}>
                    {message}
                </Text>
                {busy ? (
                    <ActivityIndicator color={colors.UtilityBlue200} size="small" />
                ) : error ? (
                    <TouchableOpacity onPress={() => setVisible(false)}>
                        <Text style={[styles.button, localStyles.action]}>{translate('Dismiss')}</Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity onPress={() => reverse(action, isUndone ? 'redo' : 'undo')}>
                        <Text style={[styles.button, localStyles.action]}>{translate(isUndone ? 'Redo' : 'Undo')}</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 24,
        zIndex: 100000,
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    container: {
        minHeight: 48,
        maxWidth: 560,
        width: '100%',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: colors.Text01,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
    },
    message: {
        color: '#FFFFFF',
        flex: 1,
        marginRight: 16,
    },
    action: {
        color: colors.UtilityBlue200,
    },
})
