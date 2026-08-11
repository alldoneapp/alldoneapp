import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import Popover from 'react-tiny-popover'
import Button from '../../../UIControls/Button'
import { useSelector } from 'react-redux'
import LanguagePickerModal from '../../../UIComponents/FloatModals/LanguagePickerModal'
import { translate } from '../../../../i18n/TranslationService'

export default function Language({ userId, language }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)

    const icons = {
        en: require('../../../../i18n/icons/UK.svg'),
        es: require('../../../../i18n/icons/Spain.svg'),
        de: require('../../../../i18n/icons/Germany.svg'),
    }

    const getLanguageName = code => {
        switch (code) {
            case 'en':
                return translate('English')
            case 'es':
                return translate('Spanish')
            case 'de':
                return translate('German')
            default:
                return translate('English')
        }
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'language'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Language')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Popover
                    content={
                        <LanguagePickerModal userId={userId} language={language} closePopover={() => setOpen(false)} />
                    }
                    onClickOutside={() => setOpen(false)}
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button
                        icon={<img src={icons[language]} alt={language} />}
                        type={'ghost'}
                        title={getLanguageName(language)}
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
