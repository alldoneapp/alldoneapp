import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import styles, { colors } from '../../../styles/global'
import CheckMark from '../../../UIComponents/FloatModals/AssigneeAndObserversModal/List/CheckMark'

export default function CopyProjectItem({ name, description, icon, isActive, onPress, style }) {
    return (
        <TouchableOpacity onPress={onPress} style={style} accessible={false}>
            <View style={localStyles.options}>
                <View style={localStyles.optionsIcon}>
                    <View style={[localStyles.icon, isActive && localStyles.activeIcon]}>
                        <Icon name={icon} size={24} color="#fff" />
                    </View>
                    {isActive && <CheckMark style={localStyles.checkMark} />}
                </View>
                <View style={localStyles.optionsDesc}>
                    <Text style={localStyles.itemHeader}>{translate(name)}</Text>
                    <Text style={localStyles.itemDescription}>{translate(description)}</Text>
                </View>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    options: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        paddingTop: 8,
    },
    optionsIcon: {
        marginRight: 8,
    },
    icon: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        width: 40,
        height: 40,
        borderRadius: 100,
        overflow: 'hidden',
        marginTop: 2,
    },
    activeIcon: {
        borderWidth: 2,
        borderColor: colors.Primary100,
    },
    optionsDesc: {
        flex: 1,
    },
    checkMark: {
        position: 'absolute',
        right: -2,
        bottom: -2,
    },
    itemHeader: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    itemDescription: {
        ...styles.caption1,
        color: colors.Text03,
    },
})
