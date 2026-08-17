import React, { useEffect, useRef } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'

import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import CloseButton from '../../../FollowUp/CloseButton'
import { translate } from '../../../../i18n/TranslationService'
import Line from '../GoalMilestoneModal/Line'
import LevelAndPoints from './LevelAndPoints'
import ButtonsArea from './ButtonsArea'
import Header from './Header'
import { protectModalDismissFromClickThrough, registerPopupDismiss } from '../../../../utils/popupDismissGuard'
import useSafeAreaOverlayPadding from '../../../../hooks/useSafeAreaOverlayPadding'

export default function LevelUpModal({ setShowLevelUpModal }) {
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    const closeTimeoutRef = useRef(null)
    const closingRef = useRef(false)

    const closeModal = event => {
        if (closingRef.current) return
        closingRef.current = true

        registerPopupDismiss()
        protectModalDismissFromClickThrough(event)

        // Keep the full-screen surface mounted until the current mobile touch
        // sequence (including compatibility mouse/click events) has finished.
        // Otherwise the trailing event is delivered to the app underneath and
        // can leave its dismissible/sidebar interaction state out of sync.
        closeTimeoutRef.current = setTimeout(() => setShowLevelUpModal(false))
    }

    useEffect(() => {
        return () => {
            clearTimeout(closeTimeoutRef.current)
        }
    }, [])

    return (
        <View style={[localStyles.parent, safeAreaOverlayPadding]}>
            <View style={[localStyles.container, applyPopoverWidth()]}>
                <Header />
                <LevelAndPoints />
                <Text style={localStyles.text}>{translate('Earned skill points description')}</Text>
                <Line style={localStyles.line} />
                <ButtonsArea closeModal={closeModal} />
                <CloseButton close={closeModal} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        ...Platform.select({ web: { position: 'fixed' } }),
    },
    container: {
        maxHeight: '90%',
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        padding: 16,
    },
    line: {
        marginVertical: 16,
    },
    text: {
        ...styles.body1,
        color: colors.Grey400,
    },
})
