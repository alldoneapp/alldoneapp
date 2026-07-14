import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { firebase } from '@firebase/app'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { reverseUndoAction } from '../../utils/undo/undoActions'

export default function FeedUndoAction({ actionId }) {
    const userId = useSelector(state => state.loggedUser?.uid)
    const [action, setAction] = useState(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (!userId || !actionId) return undefined
        return firebase
            .firestore()
            .doc(`users/${userId}/undoActions/${actionId}`)
            .onSnapshot(snapshot => setAction(snapshot.exists ? snapshot.data() : null))
    }, [userId, actionId])

    if (!action || action.expiresAt < Date.now()) return null

    const isUndone = action.status === 'undone'
    const onPress = async event => {
        event?.stopPropagation?.()
        if (busy) return
        setBusy(true)
        try {
            await reverseUndoAction(actionId, isUndone ? 'redo' : 'undo')
        } finally {
            setBusy(false)
        }
    }

    return (
        <TouchableOpacity disabled={busy} onPress={onPress} style={localStyles.button}>
            <Text style={[styles.caption1, localStyles.label]}>
                {busy ? '…' : translate(isUndone ? 'Redo' : 'Undo')}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        marginLeft: 8,
        paddingHorizontal: 4,
    },
    label: {
        color: colors.Primary200,
    },
})
