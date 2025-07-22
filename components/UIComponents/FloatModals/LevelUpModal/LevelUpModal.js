import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { getPopoverWidth } from '../../../../utils/HelperFunctions'
import CloseButton from '../../../FollowUp/CloseButton'
import { translate } from '../../../../i18n/TranslationService'
import Line from '../GoalMilestoneModal/Line'
import LevelAndPoints from './LevelAndPoints'
import ButtonsArea from './ButtonsArea'
import Header from './Header'

export default function LevelUpModal({ setShowLevelUpModal }) {
    const closeModal = () => {
        setShowLevelUpModal(false)
    }

    const onKeyDown = event => {
        if (event.key === 'Escape') closeModal()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={localStyles.parent}>
            <View style={[localStyles.container, { minWidth: getPopoverWidth(), maxWidth: getPopoverWidth() }]}>
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
    },
    container: {
        top: '50%',
        left: '58.5%',
        transform: [{ translateX: '-60%' }, { translateY: '-50%' }],
        position: 'fixed',
        width: 432,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
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
