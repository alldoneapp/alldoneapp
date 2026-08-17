import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import AutomaticOption from './AutomaticOption'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { CAPACITY_AUTOMATIC, getCustomRoundRemainder, getRelativeDateBy12Hours } from '../../../GoalsView/GoalsHelper'
import Line from '../GoalMilestoneModal/Line'
import ModalHeaderWithAvatar from '../ModalHeaderWithAvatar'
import Button from '../../../UIControls/Button'
import moment from 'moment'
import { translate } from '../../../../i18n/TranslationService'
import { getSafeAreaModalMaxHeight } from '../../../../utils/modalSafeArea'

export default function GoalSprintCapacityModal({
    assigneeId,
    capacitySelected,
    closeModal,
    updateCapacity,
    automaticCapacity,
    projectId,
}) {
    const ONE_DAY_MILLISECONDS = 86400000
    const [capacity, setCapacity] = useState(() => {
        if (capacitySelected === CAPACITY_AUTOMATIC) {
            return ''
        }
        const dateDifference = capacitySelected - Date.now()
        if (dateDifference > 0) {
            const capacity = dateDifference / ONE_DAY_MILLISECONDS
            const integerPart = Math.floor(capacity)
            const decimalPart = integerPart === 0 ? capacity : capacity % integerPart
            const roundedCapacity = integerPart + getCustomRoundRemainder(decimalPart)
            return roundedCapacity
        }
        return 0
    })
    const [showBackground, setShowBackground] = useState(capacitySelected === CAPACITY_AUTOMATIC)
    const [width, height] = useWindowSize()

    const setCustomCapacity = () => {
        const capacityTimestamp = convertCapacityToDate(capacity)
        updateCapacity(capacityTimestamp)
    }

    const convertCapacityToDate = capacity => {
        const capacityMilliseconds = capacity * ONE_DAY_MILLISECONDS
        return getRelativeDateBy12Hours(Date.now() + capacityMilliseconds, true)
    }

    const onKeyDown = event => {
        if (event.key === '-') {
            event.preventDefault()
        }
        if (event.key === 'Enter' && capacity !== '') {
            setCustomCapacity()
        }
    }

    const inputOnFocus = () => [setShowBackground(false)]

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(height) }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeaderWithAvatar
                    closeModal={closeModal}
                    title={'s sprint capacity'}
                    description={translate('How many days are left from today?')}
                    userId={assigneeId}
                    projectId={projectId}
                />
                <AutomaticOption
                    showBackground={showBackground}
                    updateCapacity={updateCapacity}
                    isSelected={capacitySelected === CAPACITY_AUTOMATIC}
                    automaticCapacity={automaticCapacity}
                />
                <Line />
                <Text style={localStyles.customText}>{translate('Custom')}</Text>
                <TextInput
                    returnKeyType={'done'}
                    placeholder={translate('Type the available days number')}
                    style={localStyles.input}
                    keyboardType="numeric"
                    onChangeText={setCapacity}
                    placeholderTextColor={colors.Text03}
                    value={capacity}
                    onFocus={inputOnFocus}
                />
                <View style={localStyles.buttonContainer}>
                    <Button
                        title={translate('Set custom')}
                        type="primary"
                        onPress={setCustomCapacity}
                        disabled={capacity === '' || capacity < 0}
                    />
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    selectedItemBackground: {
        position: 'absolute',
        left: -8,
        top: 0,
        right: -8,
        bottom: 0,
        backgroundColor: colors.Text03,
        opacity: 0.16,
        borderRadius: 4,
    },
    scroll: {
        padding: 16,
    },
    customText: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginTop: 8,
        marginBottom: 4,
    },
    input: {
        ...styles.body1,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey400,
        color: '#ffffff',
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    buttonContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
    },
})
