import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import PropertiesHeader from './PropertiesHeader'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { showConfirmPopup, showFloatPopup } from '../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_GOAL } from '../../UIComponents/ConfirmPopup'
import { DV_TAB_GOAL_PROPERTIES, DV_TAB_ROOT_GOALS } from '../../../utils/TabNavigationConstants'
import AssigneesProperty from './AssigneesProperty'
import ProgressProperty from './ProgressProperty'
import Project from '../../TaskDetailedView/Properties/Project'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import MilestoneProperty from './MilestoneProperty'
import CreatedBy from '../../TaskDetailedView/Properties/CreatedBy'
import Backend from '../../../utils/BackendBridge'
import URLsGoals, { URL_GOAL_DETAILS_PROPERTIES } from '../../../URLSystem/Goals/URLsGoals'
import FollowObject from '../../Followers/FollowObject'
import { FOLLOWER_GOALS_TYPE } from '../../Followers/FollowerConstants'
import HighlightProperty from './HighlightProperty'
import DescriptionField from '../../TaskDetailedView/Properties/DescriptionField'
import { FEED_GOAL_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import { translate } from '../../../i18n/TranslationService'
import ObjectRevisionHistory from '../../NotesView/NotesDV/PropertiesView/ObjectRevisionHistory'
import Privacy from './Privacy'
import Reminder from './Reminder'
import AssistantProperty from '../../UIComponents/FloatModals/ChangeAssistantModal/AssistantProperty'
import { getUserData } from '../../../utils/backends/Users/usersFirestore'

export default function GoalProperties({ projectId, goal, accessGranted }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const loggedUser = useSelector(state => state.loggedUser)
    const [creator, setCreator] = useState(null)

    const project = ProjectHelper.getProjectById(projectId)
    const item = { type: 'goal', data: goal }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_GOAL_PROPERTIES) {
            const data = { projectId, goal: goal.id }
            URLsGoals.push(URL_GOAL_DETAILS_PROPERTIES, data, projectId, goal.id)
        }
    }

    const deleteGoal = () => {
        dispatch([
            showFloatPopup(),
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_GOAL,
                object: {
                    refKey: goal.id,
                    goal: goal,
                    projectId,
                    navigation: DV_TAB_ROOT_GOALS,
                    headerText: 'Be careful, this action is permanent',
                    headerQuestion: 'Do you really want to perform this action?',
                },
            }),
        ])
    }

    useEffect(() => {
        getUserData(goal.creatorId, false).then(setCreator)
        writeBrowserURL()
    }, [])

    const isGuide = !!project.parentTemplateId
    const loggedUserIsGoalOwner = goal.ownerId === loggedUser.uid
    const loggedUserCanUpdateObject =
        loggedUserIsGoalOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        <View style={localStyles.container}>
            <PropertiesHeader />
            <View style={[localStyles.properties, smallScreen ? localStyles.propertiesMobile : undefined]}>
                <View style={{ flex: 1, marginRight: smallScreen ? 0 : 72 }}>
                    <AssigneesProperty goal={goal} projectId={projectId} disabled={!accessGranted || isGuide} />
                    <Project item={item} project={project} disabled={!accessGranted} />
                    <MilestoneProperty
                        goal={goal}
                        projectId={projectId}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                    />
                    <HighlightProperty
                        projectId={projectId}
                        object={goal}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                        updateFunction={Backend.updateGoalHighlight}
                    />
                </View>
                <View style={{ flex: 1 }}>
                    <AssistantProperty
                        projectId={projectId}
                        assistantId={goal.assistantId}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                        objectId={goal.id}
                        objectType={'goals'}
                    />
                    <ProgressProperty
                        goal={goal}
                        projectId={projectId}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                    />
                    <Privacy
                        projectId={projectId}
                        object={goal}
                        objectType={FEED_GOAL_OBJECT_TYPE}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                    />
                    <Reminder
                        goal={goal}
                        projectId={projectId}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                    />
                    {accessGranted && (
                        <FollowObject
                            projectId={projectId}
                            followObjectsType={FOLLOWER_GOALS_TYPE}
                            followObjectId={goal.id}
                            loggedUserId={loggedUser.uid}
                            object={goal}
                        />
                    )}
                    <CreatedBy createdDate={goal.created} creator={creator} />
                </View>
            </View>

            <DescriptionField
                projectId={projectId}
                object={goal}
                disabled={!accessGranted || !loggedUserCanUpdateObject}
                objectType={FEED_GOAL_OBJECT_TYPE}
            />

            {accessGranted && loggedUserCanUpdateObject && (
                <View style={localStyles.footerSection}>
                    <ObjectRevisionHistory projectId={projectId} noteId={goal.noteId} />
                    <View style={localStyles.footerRow}>
                        <Button
                            icon={'trash-2'}
                            title={translate('Delete Goal')}
                            type={'ghost'}
                            iconColor={colors.UtilityRed200}
                            titleStyle={{ color: colors.UtilityRed200 }}
                            buttonStyle={{ borderColor: colors.UtilityRed200, borderWidth: 2 }}
                            onPress={deleteGoal}
                            accessible={false}
                        />
                    </View>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        marginBottom: 92,
    },
    properties: {
        flexDirection: 'row',
    },
    propertiesMobile: {
        flexDirection: 'column',
    },

    footerSection: {
        marginTop: 24,
    },
    footerRow: {
        paddingVertical: 8,
        alignSelf: 'flex-end',
    },
})
