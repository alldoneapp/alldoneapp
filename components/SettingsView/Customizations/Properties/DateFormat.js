import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import Popover from 'react-tiny-popover'
import Button from '../../../UIControls/Button'
import { useSelector } from 'react-redux'
import DateFormatPickerModal, { DATE_FORMAT_EUROPE } from '../../../UIComponents/FloatModals/DateFormatPickerModal'
import moment from 'moment'
import { translate } from '../../../../i18n/TranslationService'

export default function DateFormat({ userId, dateFormat }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'calendar'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Date Format')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Popover
                    content={
                        <DateFormatPickerModal
                            userId={userId}
                            dateFormat={dateFormat}
                            closePopover={() => setOpen(false)}
                        />
                    }
                    onClickOutside={() => setOpen(false)}
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button
                        icon={'edit'}
                        type={'ghost'}
                        title={`${moment().format(dateFormat)} • ${
                            dateFormat === DATE_FORMAT_EUROPE
                                ? translate(mobile ? 'Monday' : 'Monday first')
                                : translate(mobile ? 'Sunday' : 'Sunday first')
                        }`}
                        onPress={() => setOpen(true)}
                    />
                </Popover>
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
