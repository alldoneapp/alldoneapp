import React, { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { showConfirmPopup, showFloatPopup } from '../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_SKILL } from '../../UIComponents/ConfirmPopup'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import Project from '../../TaskDetailedView/Properties/Project'
import CreatedBy from '../../TaskDetailedView/Properties/CreatedBy'
import Backend from '../../../utils/BackendBridge'
import FollowObject from '../../Followers/FollowObject'
import { FOLLOWER_SKILLS_TYPE } from '../../Followers/FollowerConstants'
import DescriptionField from '../../TaskDetailedView/Properties/DescriptionField'
import { FEED_SKILL_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import { translate } from '../../../i18n/TranslationService'
import ObjectRevisionHistory from '../../NotesView/NotesDV/PropertiesView/ObjectRevisionHistory'
import HighlightProperty from '../../GoalDetailedView/GoalProperties/HighlightProperty'
import Privacy from '../../GoalDetailedView/GoalProperties/Privacy'
import URLsSkills, { URL_SKILL_DETAILS_PROPERTIES } from '../../../URLSystem/Skills/URLsSkills'
import { DV_TAB_SKILL_PROPERTIES } from '../../../utils/TabNavigationConstants'
import PropertiesHeader from '../../GoalDetailedView/GoalProperties/PropertiesHeader'
import SkillOwner from './SkillOwner'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import Skillpoints from './Skillpoints'
import CompletionProperty from './CompletionProperty'
import AssistantProperty from '../../UIComponents/FloatModals/ChangeAssistantModal/AssistantProperty'
import { getUserData } from '../../../utils/backends/Users/usersFirestore'

export default function SkillProperties({ projectId, accessGranted }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const skill = useSelector(state => state.skillInDv)
    const [creator, setCreator] = useState(null)

    const isSkillsOwner = !isAnonymous && skill.userId === loggedUserId
    const project = ProjectHelper.getProjectById(projectId)

    const deleteSkill = () => {
        dispatch([
            showFloatPopup(),
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_SKILL,
                object: {
                    refKey: skill.id,
                    skill,
                    projectId,
                    headerText: 'Be careful, this action is permanent',
                    headerQuestion: 'Do you really want to perform this action?',
                    navigation: DV_TAB_ROOT_TASKS,
                },
            }),
        ])
    }

    const writeBrowserURL = () => {
        if (selectedNavItem === DV_TAB_SKILL_PROPERTIES) {
            URLsSkills.push(URL_SKILL_DETAILS_PROPERTIES, { projectId, skill: skill.id }, projectId, skill.id)
        }
    }

    useEffect(() => {
        getUserData(skill.userId, false).then(setCreator)
        writeBrowserURL()
    }, [])

    return (
        <View style={localStyles.container}>
            <PropertiesHeader />
            <View style={[localStyles.properties, smallScreen ? localStyles.propertiesMobile : undefined]}>
                <View style={{ flex: 1, marginRight: smallScreen ? 0 : 72 }}>
                    <SkillOwner userId={skill.userId} projectId={projectId} />
                    <Project
                        item={{ type: 'skill', data: skill }}
                        project={project}
                        disabled={!accessGranted || !isSkillsOwner}
                    />
                    <HighlightProperty
                        projectId={projectId}
                        object={skill}
                        disabled={!accessGranted || !isSkillsOwner}
                        updateFunction={Backend.updateSkillHighlight}
                    />
                    <Privacy
                        projectId={projectId}
                        object={skill}
                        objectType={FEED_SKILL_OBJECT_TYPE}
                        disabled={!accessGranted || !isSkillsOwner}
                    />
                </View>

                <View style={{ flex: 1 }}>
                    <AssistantProperty
                        projectId={projectId}
                        assistantId={skill.assistantId}
                        disabled={!accessGranted || !isSkillsOwner}
                        objectId={skill.id}
                        objectType={'skills'}
                    />
                    <CompletionProperty
                        projectId={projectId}
                        skill={skill}
                        disabled={!accessGranted || !isSkillsOwner}
                    />
                    <Skillpoints projectId={projectId} disabled={!accessGranted || !isSkillsOwner} />
                    {accessGranted && (
                        <FollowObject
                            projectId={projectId}
                            followObjectsType={FOLLOWER_SKILLS_TYPE}
                            followObjectId={skill.id}
                            loggedUserId={loggedUserId}
                            object={skill}
                        />
                    )}
                    <CreatedBy createdDate={skill.created} creator={creator} />
                </View>
            </View>

            <DescriptionField
                projectId={projectId}
                object={skill}
                disabled={!accessGranted || !isSkillsOwner}
                objectType={FEED_SKILL_OBJECT_TYPE}
            />

            {accessGranted && isSkillsOwner && (
                <View style={localStyles.footerSection}>
                    <ObjectRevisionHistory projectId={projectId} noteId={skill.noteId} />
                    <View style={localStyles.footerRow}>
                        <Button
                            icon={'trash-2'}
                            title={translate('Delete Skill')}
                            type={'ghost'}
                            iconColor={colors.UtilityRed200}
                            titleStyle={{ color: colors.UtilityRed200 }}
                            buttonStyle={{ borderColor: colors.UtilityRed200, borderWidth: 2 }}
                            onPress={deleteSkill}
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
