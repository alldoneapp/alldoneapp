import React, { useEffect, useState } from 'react'
import { Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { showNoteChangedNotification } from '../../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'
import {
    FEED_NOTE_DELETED,
    FEED_NOTE_PROJECT_CHANGED_FROM,
    FEED_NOTE_PROJECT_CHANGED_TO,
} from '../../Feeds/Utils/FeedsConstants'
import { isEmpty } from 'lodash'
import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function NoteChangedNotificationModal() {
    const dispatch = useDispatch()
    const showNotification = useSelector(state => state.noteChangedNotification)
    const { uid: userId } = useSelector(state => state.loggedUser)
    const [avatarUrl, setAvatarUrl] = useState('')
    const [text, setText] = useState('')
    const [effectingUserId, setEffectingUserId] = useState('')

    useEffect(() => {
        if (!isEmpty(showNotification)) {
            for (let object of showNotification) {
                const { creatorId, type, projectId } = object
                if (type === FEED_NOTE_DELETED) {
                    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)
                    setAvatarUrl(photoURL)
                    setEffectingUserId(creatorId)
                    setText(`${shortName} just deleted the note you were in.`)
                    return
                } else if (type === FEED_NOTE_PROJECT_CHANGED_TO || type === FEED_NOTE_PROJECT_CHANGED_FROM) {
                    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)
                    setAvatarUrl(photoURL)
                    setEffectingUserId(creatorId)
                    setText(`${shortName} just moved the note you were in to another project.`)
                    return
                }
            }

            const { photoURL, shortName } = getUserPresentationDataInProject(
                showNotification[0].projectId,
                showNotification[0].creatorId
            )
            setAvatarUrl(photoURL)
            setEffectingUserId(showNotification[0].creatorId)
            setText(`${shortName} just did some changes to the note you were in and it become inaccessible.`)
        }
    }, [showNotification])

    // This is to close immediately the popup when it try to appear for the effecting user
    useEffect(() => {
        if (effectingUserId !== '') {
            if (effectingUserId === userId) {
                close()
            } else {
                setTimeout(() => {
                    close()
                }, 5000)
            }
        }
    }, [effectingUserId])

    const close = () => {
        setAvatarUrl('')
        setText('')
        setEffectingUserId('')
        dispatch(showNoteChangedNotification(false))
    }

    return (
        !!showNotification &&
        effectingUserId !== userId && (
            <View style={localStyles.container}>
                <Text style={[styles.title7, localStyles.title]}>Note not available</Text>
                <View style={localStyles.body}>
                    <Image style={localStyles.userImage} source={{ uri: avatarUrl }} />
                    <Text style={localStyles.text}>{text}</Text>
                </View>
                <TouchableOpacity style={localStyles.closeButton} onPress={close}>
                    <Icon name="x" size={24} color={colors.Text03} />
                </TouchableOpacity>
            </View>
        )
    )
}

const localStyles = StyleSheet.create({
    container: {
        zIndex: 100000,
        position: 'absolute',
        right: 56,
        bottom: 56,
        width: 256,
        backgroundColor: colors.UtilityRed112,
        borderRadius: 4,
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${24}px rgba(0,0,0,0.04), ${0}px ${8}px ${16}px rgba(0, 0, 0, 0.04)`,
            },
        }),
        paddingVertical: 16,
        paddingHorizontal: 16,
    },
    body: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
    },
    userImage: {
        backgroundColor: '#cccccc',
        borderRadius: 50,
        width: 22,
        height: 22,
    },
    title: {
        color: colors.UtilityRed300,
        fontWeight: '500',
    },
    text: {
        ...styles.body2,
        color: colors.Text02,
        marginLeft: 8,
    },
    closeButton: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
})
