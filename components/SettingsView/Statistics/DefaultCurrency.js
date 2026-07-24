import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import Popover from 'react-tiny-popover'
import Button from '../../UIControls/Button'
import { useSelector, useDispatch } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import DefaultCurrencyModal from './DefaultCurrencyModal'

export default function DefaultCurrency({ userId, defaultCurrency }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const [visiblePopover, setVisiblePopover] = useState(false)

    const showPopover = () => {
        setVisiblePopover(true)
        dispatch(showFloatPopup())
    }

    const hidePopover = () => {
        setTimeout(() => {
            setVisiblePopover(false)
            dispatch(hideFloatPopup())
        })
    }

    const currentCurrency = defaultCurrency || 'EUR'

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'credit-card'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Default currency')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Popover
                    content={
                        <DefaultCurrencyModal
                            userId={userId}
                            currentCurrency={currentCurrency}
                            hidePopover={hidePopover}
                        />
                    }
                    onClickOutside={hidePopover}
                    isOpen={visiblePopover}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={smallScreen ? null : undefined}
                >
                    <Button type={'ghost'} onPress={showPopover} title={currentCurrency} />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    settingRow: {
        height: 64,
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
    },
    settingRowRight: {
        justifyContent: 'flex-end',
        paddingRight: 8,
    },
})
