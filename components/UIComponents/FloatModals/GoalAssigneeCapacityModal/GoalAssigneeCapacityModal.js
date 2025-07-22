import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import ModalHeaderWithAvatar from '../ModalHeaderWithAvatar'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import CapacityItem from './CapacityItem'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { capacityData, CAPACITY_AUTOMATIC } from '../../../GoalsView/GoalsHelper'
import BackButton from '../GoalMilestoneModal/BackButton'
import { translate } from '../../../../i18n/TranslationService'

export default function GoalAssigneeCapacityModal({
    capacitySelected,
    closeModal,
    closeModalForButtonX,
    updateCapacity,
    assigneeId,
    showBackButton,
    projectId,
}) {
    const [capacity, setCapacity] = useState(capacitySelected)
    const [width, height] = useWindowSize()
    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeaderWithAvatar
                    closeModal={closeModalForButtonX ? closeModalForButtonX : closeModal}
                    userId={assigneeId}
                    title={'s capacity'}
                    description={translate('Select from the options below')}
                    projectId={projectId}
                />
                {capacityData.map(capacityData => {
                    const { key } = capacityData
                    return key !== CAPACITY_AUTOMATIC ? (
                        <CapacityItem
                            key={key}
                            capacityKey={key}
                            updateCapacity={updateCapacity}
                            closeModal={closeModal}
                            isSelected={key === capacity}
                        />
                    ) : null
                })}
                {showBackButton && <BackButton onPress={closeModal} />}
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
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
        paddingBottom: 8,
    },
})
