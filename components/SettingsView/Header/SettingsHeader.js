import React from 'react'
import { StyleSheet, View, Text } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import BackButton from './BackButton'
import { useSelector } from 'react-redux'
import { useTranslator, translate } from '../../../i18n/TranslationService'

export const SettingsHeader = ({}) => {
    useTranslator()
    const mobile = useSelector(state => state.isMiddleScreen)

    return (
        <View style={localStyles.container}>
            <View style={localStyles.upperHeader}>
                {mobile && (
                    <View style={localStyles.backButtonMobile}>
                        <BackButton />
                    </View>
                )}
                <View style={{ marginRight: 'auto', flex: 1 }}>
                    <Text style={[styles.title4, localStyles.title]}>{translate('Settings')}</Text>
                </View>
                <View style={[localStyles.icon]}>
                    <Icon name={'settings'} size={24} color={colors.Text03} />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 96,
        minHeight: 96,
        maxHeight: 96,
        flexDirection: 'column',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    upperHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    title: {
        paddingTop: 32,
        height: 64,
        flex: 1,
    },
    icon: {
        marginTop: 36,
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButtonMobile: {
        left: -16,
    },
})

export default SettingsHeader
