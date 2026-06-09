import React, { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'

import SelectHappinessRangeModal from './SelectHappinessRangeModal'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import styles, { colors } from '../styles/global'
import Button from '../UIControls/Button'
import { translate } from '../../i18n/TranslationService'

export default function HappinessFilterBy({ updateFilterData, happinessFilter, rangeLabel }) {
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

    return (
        <Popover
            content={
                <SelectHappinessRangeModal
                    updateFilterData={updateFilterData}
                    hidePopover={hidePopover}
                    happinessFilter={happinessFilter}
                />
            }
            onClickOutside={hidePopover}
            isOpen={visiblePopover}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <View style={localStyles.container}>
                <Text style={[styles.body2, { color: colors.Text02 }]}>{translate('Filtered By')}</Text>
                <Button
                    title={rangeLabel}
                    type={'ghost'}
                    icon={'calendar'}
                    buttonStyle={{ marginLeft: 16 }}
                    onPress={showPopover}
                />
            </View>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        paddingLeft: 16,
        height: 40,
        borderLeftWidth: 1,
        borderColor: colors.Grey200,
        alignItems: 'center',
    },
})
