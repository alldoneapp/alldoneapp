import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import Popover from 'react-tiny-popover'
import Button from '../../../UIControls/Button'
import { useSelector } from 'react-redux'
import AppThemeModal, { themeOptionsMap } from '../../../UIComponents/FloatModals/AppThemeModal'
import { translate } from '../../../../i18n/TranslationService'

export default function Theme({ userId, themeName }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'palette'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('App theme')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Popover
                    content={
                        <AppThemeModal userId={userId} themeName={themeName} closePopover={() => setOpen(false)} />
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
                        title={translate(themeOptionsMap[themeName].name)}
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
