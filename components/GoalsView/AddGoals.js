import React from 'react'
import { View } from 'react-native'

import DismissibleItem from '../UIComponents/DismissibleItem'
import AddGoalsPresentation from './AddGoalsPresentation'
import EditGoal from './EditGoal'
import SortModeActiveInfo from './SortModeActiveInfo'

export default function AddGoals({
    projectId,
    setDismissibleRefs,
    openEdition,
    closeEdition,
    milestoneId,
    milestoneDate,
    refId,
    activeDragGoalMode,
    containerStyle,
}) {
    const setRef = ref => {
        setDismissibleRefs(ref, refId)
    }

    const openEditionMode = () => {
        openEdition(refId)
    }

    const closeEditionMode = () => {
        closeEdition(refId)
    }

    return (
        <View style={containerStyle}>
            {activeDragGoalMode ? (
                <SortModeActiveInfo />
            ) : (
                <DismissibleItem
                    ref={setRef}
                    defaultComponent={<AddGoalsPresentation onPress={openEditionMode} />}
                    modalComponent={
                        <EditGoal
                            projectId={projectId}
                            onCancelAction={closeEditionMode}
                            adding={true}
                            milestoneId={milestoneId}
                            milestoneDate={milestoneDate}
                        />
                    }
                />
            )}
        </View>
    )
}
