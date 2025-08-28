import React, { useEffect, useState } from 'react'
import { StyleSheet, View, Dimensions } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import GoalEditForm from './GoalEditForm'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import ModalHeader from '../ModalHeader'
import { translate } from '../../../../i18n/TranslationService'

export default function MainModal({
    projectId,
    closeModal,
    goal,
    showAssigneeModal,
    showDateRange,
    showPrivacy,
    showAssignees,
    showDescription,
    showHighlight,
    createGoal,
    setGoal,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [screenDimensions, setScreenDimensions] = useState(Dimensions.get('window'))

    const setDimensions = e => {
        setScreenDimensions(e.window)
    }

    useEffect(() => {
        Dimensions.addEventListener('change', setDimensions)
        return () => {
            Dimensions.removeEventListener('change', setDimensions)
        }
    })

    return (
        <View
            style={[
                localStyles.container,
                applyPopoverWidth(),
                smallScreenNavigation && { minWidth: 315 },
                { maxHeight: screenDimensions.height - 32 },
            ]}
        >
            <ModalHeader closeModal={closeModal} title={translate('Add goal')} description="" />
            <GoalEditForm
                projectId={projectId}
                isAssigneeVisible={showAssigneeModal}
                goal={goal}
                setGoal={setGoal}
                createGoal={createGoal}
                showDateRange={showDateRange}
                showPrivacy={showPrivacy}
                showAssignees={showAssignees}
                showDescription={showDescription}
                showHighlight={showHighlight}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        height: 'auto',
    },
})
