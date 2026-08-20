import React, { useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'

import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'
import { applyPopoverWidth } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'
import {
    CONNECTION_HEALTH_OFFLINE,
    CONNECTION_HEALTH_RECONNECTING,
    CONNECTION_HEALTH_STALE,
    reconnectNow,
} from '../../utils/connectionHealth'

/**
 * The explanation behind the connection chip (PT-4660).
 *
 * Every string here is written to be true of what the app actually does, which is
 * the whole point of the feature — an indicator that overstates the problem is a
 * defect of the same severity as one that misses it. In particular none of these
 * states blocks anything: Firestore queues writes locally and flushes them on
 * reconnect, so work done while stale or offline is not lost and the copy must not
 * imply that it is.
 */
export const CONNECTION_STATUS_COPY = {
    [CONNECTION_HEALTH_RECONNECTING]: {
        title: 'Reconnecting',
        description: 'Alldone is checking the connection to the server. This usually takes a few seconds.',
    },
    [CONNECTION_HEALTH_STALE]: {
        title: 'Not up to date',
        description:
            'Alldone cannot reach the server right now, so what you see may be out of date. You can keep working — your changes are saved and will sync as soon as the connection is back.',
    },
    [CONNECTION_HEALTH_OFFLINE]: {
        title: 'Alldone is offline',
        description:
            'Your device has no internet connection. You can keep working — your changes are saved and will sync as soon as you are back online.',
    },
}

export default function ConnectionStatusModal({ connectionHealth, closeModal }) {
    const [reconnecting, setReconnecting] = useState(false)
    const copy = CONNECTION_STATUS_COPY[connectionHealth]

    if (!copy) return null

    const onReconnect = async () => {
        setReconnecting(true)
        try {
            await reconnectNow()
        } finally {
            setReconnecting(false)
            if (typeof closeModal === 'function') closeModal()
        }
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <Text style={localStyles.title}>{translate(copy.title)}</Text>
            <Text style={localStyles.description}>{translate(copy.description)}</Text>
            <View style={localStyles.buttonRow}>
                <Button
                    title={translate('Reconnect now')}
                    type={'primary'}
                    onPress={onReconnect}
                    disabled={reconnecting || connectionHealth === CONNECTION_HEALTH_RECONNECTING}
                    testID={'connection-status-reconnect'}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    // Same card treatment as the FloatModals family: dark Secondary400 with light
    // text, so it reads as one of the app's popovers and renders unchanged inside
    // AppPopover's bottom sheet on phones.
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        padding: 16,
        ...Platform.select({
            web: { boxShadow: '0px 4px 16px rgba(78,93,120,0.56)' },
        }),
        elevation: 3,
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 8,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 16,
    },
})
