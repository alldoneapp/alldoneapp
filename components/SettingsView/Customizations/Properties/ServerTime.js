import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import momentTz from 'moment-timezone'
import Backend from '../../../../utils/BackendBridge'
import { getDateFormat, getTimeFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../../../i18n/TranslationService'

export default function ServerTime({}) {
    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'airplay'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Server Time (UTC)')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Text style={styles.body1}>
                    {momentTz(Backend.getFirebaseTimestamp()).utc().format(`${getDateFormat()}, ${getTimeFormat()}`)}
                </Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    settingRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    settingRowRight: {
        justifyContent: 'flex-end',
    },
})
