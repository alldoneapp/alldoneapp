import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import { getPopoverWidth } from '../../utils/HelperFunctions'
import Button from '../UIControls/Button'
import CloseButton from '../FollowUp/CloseButton'
import { navigateToSettings, setShowLimitedFeatureModal } from '../../redux/actions'
import NavigationService from '../../utils/NavigationService'
import { DV_TAB_SETTINGS_PREMIUM } from '../../utils/TabNavigationConstants'
import { translate } from '../../i18n/TranslationService'

export default function LimitedFeatureModal() {
    const dispatch = useDispatch()
    const modalState = useSelector(state => state.showLimitedFeatureModal)

    const closeModal = () => {
        dispatch(setShowLimitedFeatureModal(false))
    }

    const navigateToPremium = () => {
        NavigationService.navigate('SettingsView')
        dispatch([
            navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PREMIUM }),
            dispatch(setShowLimitedFeatureModal(false)),
        ])
    }

    const header = typeof modalState === 'object' && modalState.title ? modalState.title : translate('Limited feature')
    const description =
        typeof modalState === 'object' && modalState.description
            ? modalState.description
            : translate(
                  'Sorry, this feature is only available for premium users, please upgrade to premium to get the full potential of Alldone'
              )

    return (
        <View style={localStyles.parent}>
            <View style={[localStyles.container, { minWidth: getPopoverWidth(), maxWidth: getPopoverWidth() }]}>
                <View style={{ paddingHorizontal: 16 }}>
                    <Text style={[styles.title7, { color: 'white' }]}>{header}</Text>
                    <Text style={[styles.body1, { color: colors.Grey400 }]}>{description}</Text>
                </View>

                <View style={localStyles.line} />

                <View style={{ paddingHorizontal: 16 }}>
                    <Button
                        title={translate('Upgrade to Premium')}
                        icon={'crown'}
                        iconSize={22}
                        buttonStyle={localStyles.button}
                        onPress={navigateToPremium}
                    />
                </View>
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
        paddingVertical: 16,
    },
    subtitle: {
        ...styles.body2,
        color: colors.Text03,
    },
    line: {
        borderWidth: 1,
        borderBottomColor: '#fff',
        marginTop: 8,
        marginBottom: 8,
        opacity: 0.2,
    },
    button: {
        alignSelf: 'center',
        marginTop: 20,
    },
})
