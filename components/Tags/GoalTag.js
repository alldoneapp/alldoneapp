import React, { useEffect, useState } from 'react'
import { StyleSheet, TouchableOpacity, Text } from 'react-native'
import v4 from 'uuid/v4'
import { useDispatch } from 'react-redux'

import styles, { colors } from '../styles/global'
import GoalProgress from '../Feeds/CommentsTextInput/MentionsModal/GoalProgress'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'
import { watchGoal } from '../../utils/backends/Goals/goalsFirestore'
import { unwatch } from '../../utils/backends/firestore'
import { translate } from '../../i18n/TranslationService'
import NavigationService from '../../utils/NavigationService'
import { navigateToGoal } from '../../redux/actions'
import { DV_TAB_GOAL_LINKED_TASKS } from '../../utils/TabNavigationConstants'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function GoalTag({ projectId, goalId, containerStyle, disabled }) {
    const dispatch = useDispatch()
    const [goal, setGoal] = useState(null)

    const goToGoalDv = () => {
        NavigationService.navigate('GoalDetailedView', {
            goalId,
            projectId,
        })

        dispatch(
            navigateToGoal({
                selectedProjectIndex: ProjectHelper.getProjectById(projectId)?.index,
                selectedNavItem: DV_TAB_GOAL_LINKED_TASKS,
            })
        )
    }

    useEffect(() => {
        const watcherKey = v4()
        watchGoal(projectId, goalId, watcherKey, setGoal)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId, goalId])

    const name = goal ? shrinkTagText(goal.name, 8) : translate('Loading')

    return (
        <TouchableOpacity disabled={disabled} onPress={goToGoalDv} style={[localStyles.container, containerStyle]}>
            {goal && (
                <GoalProgress
                    progress={goal.progress}
                    projectId={projectId}
                    dynamicProgress={goal.dynamicProgress}
                    containerStyle={localStyles.progress}
                />
            )}
            <Text style={localStyles.text}>{name}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
        paddingLeft: 6,
        paddingRight: 4,
    },
    progress: {
        marginTop: 0,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 4,
        marginLeft: 4,
    },
})
