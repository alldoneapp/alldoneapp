import React from 'react'
import { View, Text, StyleSheet, Platform } from 'react-native'

import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import Illustration from '../../../assets/svg/PushNotificationsDesktop'
import IllustrationMobile from '../../../assets/svg/PushNotificationsMobile'
import { useDispatch, useSelector } from 'react-redux'
import { hideConfirmPopup, hideFloatPopup } from '../../../redux/actions'
import Backend from '../../../utils/BackendBridge'
import { initFCM } from '../../../utils/backends/firestore'

export default function PushNotificationsModalMandatory() {
    const smallScreen = useSelector(state => state.smallScreen)
    const showConfirmPopupData = useSelector(state => state.showConfirmPopupData)
    const dispatch = useDispatch()
    const onCancel = e => {
        if (e) e.preventDefault()
        dispatch([hideFloatPopup(), hideConfirmPopup()])
        const db = Backend.getDb()
        const { uid } = showConfirmPopupData.object
        db.doc(`users/${uid}`).update({ pushNotificationsStatus: false })
    }

    const onAllow = e => {
        if (e) e.preventDefault()
        dispatch([hideFloatPopup(), hideConfirmPopup()])
        const db = Backend.getDb()
        const { uid } = showConfirmPopupData.object
        db.doc(`users/${uid}`).update({ pushNotificationsStatus: true })
        initFCM()
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.illustrationContainer}>
                {smallScreen ? <IllustrationMobile></IllustrationMobile> : <Illustration></Illustration>}
            </View>

            <Text style={[styles.title4, { color: colors.Text01 }]}>
                Alldone would like to send you important notifications like meeting invites
            </Text>

            <View style={localStyles.explanation}>
                <Text style={[styles.body1, { color: colors.Text02 }]}>
                    Notifications may include alerts, sound and icon badges. This will be used to keep you updated about
                    what matters to you in your projects.
                </Text>
            </View>

            <View style={localStyles.buttonContainer}>
                <View style={localStyles.buttonSection}>
                    <Button title={'Deny'} type={'secondary'} onPress={onCancel} shortcutText={'Esc'}></Button>
                    <Button title={'Allow'} type={'primary'} onPress={onAllow} shortcutText={'Enter'}></Button>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        maxWidth: 448,
        backgroundColor: 'white',
        padding: 16,
        borderRadius: 8,
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${32}px rgba(0,0,0,0.04), ${0}px ${16}px ${24}px rgba(0, 0, 0, 0.04)`,
            },
        }),
    },
    explanation: {
        maxWidth: 416,
        maxHeight: 72,
        marginTop: 16,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        flex: 1,
        marginTop: 16,
    },
    buttonSection: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        minWidth: 152,
    },
    illustrationContainer: {
        maxWidth: 416,
        minHeight: 200,
        backgroundColor: '#F0F4FF',
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
})
