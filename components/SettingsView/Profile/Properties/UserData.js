import React from 'react'
import moment from 'moment'
import { Image, StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { getDateFormat, getTimeFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../../../i18n/TranslationService'

export default function UserData({ user, projectRole }) {
    const { role, photoURL, displayName, level, lastLogin } = user

    const roleToShow = projectRole ? projectRole : role

    return (
        <View style={localStyles.userData}>
            <View style={localStyles.userPhoto}>
                <Image source={photoURL} style={localStyles.userPhotoImage} />
            </View>
            <View style={localStyles.userTexts}>
                <Text style={[styles.title6, { marginBottom: 4 }]} numberOfLines={1}>
                    {displayName}
                </Text>
                {!!roleToShow && (
                    <Text style={[styles.subtitle1, { color: colors.Text02, marginBottom: 4 }]} numberOfLines={1}>
                        {roleToShow}
                    </Text>
                )}
                <View style={localStyles.centeredRow}>
                    <Icon name="star" size={17} color="#8A94A6" />
                    <Text style={(styles.body2, { color: '#4E5D78', marginLeft: 5 })}>
                        {translate('Level', { level: level })}
                    </Text>
                </View>
                <Text style={[styles.caption2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Last login', {
                        date: moment(lastLogin).format(`${getDateFormat()}, ${getTimeFormat(true)}`),
                    })}
                </Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    userData: {
        height: 144,
        flexDirection: 'row',
        justifyContent: 'center',
    },
    userTexts: {
        flex: 1,
        height: 144,
        justifyContent: 'center',
        marginLeft: 24,
    },
    userPhoto: {
        width: 144,
        minWidth: 144,
        maxWidth: 144,
        height: 144,
    },
    userPhotoImage: {
        width: 144,
        height: 144,
        borderRadius: 200,
        backgroundColor: colors.Text03,
    },
    centeredRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    deleteButton: {
        borderColor: colors.UtilityRed200,
        borderWidth: 2,
        marginTop: 16,
    },
})
