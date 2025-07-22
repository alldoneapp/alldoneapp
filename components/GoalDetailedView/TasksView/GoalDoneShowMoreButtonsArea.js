import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { View, StyleSheet } from 'react-native'

import ShowMoreButton from '../../UIControls/ShowMoreButton'
import { setGoalDoneTasksExpandedAmount, setShowLimitedFeatureModal } from '../../../redux/actions'
import { AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON } from '../../../utils/backends/doneTasks'
import { PLAN_STATUS_PREMIUM } from '../../Premium/PremiumHelper'

export default function GoalDoneShowMoreButtonsArea() {
    const dispatch = useDispatch()
    const goalDoneTasksData = useSelector(state => state.goalDoneTasksData)
    const goalDoneTasksExpandedAmount = useSelector(state => state.goalDoneTasksExpandedAmount)
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)

    const expandTasks = () => {
        premiumStatus === PLAN_STATUS_PREMIUM
            ? dispatch(
                  setGoalDoneTasksExpandedAmount(
                      goalDoneTasksExpandedAmount + AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON
                  )
              )
            : dispatch(setShowLimitedFeatureModal(true))
    }

    const contractTasks = () => {
        dispatch(
            setGoalDoneTasksExpandedAmount(
                goalDoneTasksExpandedAmount - AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON
            )
        )
    }

    const getTotalTasksAmount = () => {
        let amount = 0
        goalDoneTasksData.forEach(taskData => {
            amount += taskData[1]
        })
        return amount
    }

    const firstDayTasksAmount = goalDoneTasksData.length > 0 ? goalDoneTasksData[0][1] : 0
    const totalTasksAmount = getTotalTasksAmount()

    const showEarlierTasksButton = totalTasksAmount > firstDayTasksAmount + goalDoneTasksExpandedAmount
    const showHideEarlierTasksButton = goalDoneTasksExpandedAmount > 0

    return (
        <View style={localStyles.container}>
            {showEarlierTasksButton && (
                <ShowMoreButton
                    expanded={false}
                    expand={expandTasks}
                    expandText={'earlier tasks'}
                    style={{ flex: 0, marginRight: 16 }}
                />
            )}
            {showHideEarlierTasksButton > 0 && (
                <ShowMoreButton
                    expanded={true}
                    contract={contractTasks}
                    contractText={'hide earlier tasks'}
                    style={{ flex: 0 }}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
