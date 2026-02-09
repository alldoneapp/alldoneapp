import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import {
    DV_TAB_SKILL_PROPERTIES,
    DV_TAB_SKILL_BACKLINKS,
    DV_TAB_SKILL_NOTE,
    DV_TAB_SKILL_CHAT,
    DV_TAB_SKILL_UPDATES,
} from '../../utils/TabNavigationConstants'
import SkillProperties from './SkillProperties/SkillProperties'
import BacklinksView from '../BacklinksView/BacklinksView'
import { LINKED_OBJECT_TYPE_SKILL } from '../../utils/LinkingHelper'
import NoteIntegration from '../NoteIntegration/NoteIntegration'
import ChatBoard from '../ChatsView/ChatDV/ChatBoard'
import RootViewFeedsSkills from '../Feeds/RootViewFeedsSkills'
import { setDvIsFullScreen } from '../../redux/actions'

export default function Sections({ projectId, userHasAccessToProject }) {
    const dispatch = useDispatch()
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const isFullScreen = useSelector(state => state.dvIsFullScreen)
    const skillInDv = useSelector(state => state.skillInDv)
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const { id: skillId, noteId, userId, extendedName, isPublicFor, assistantId } = skillInDv

    const linkedParentObject = {
        type: LINKED_OBJECT_TYPE_SKILL,
        id: skillId,
        idsField: 'linkedParentSkillsIds',
    }

    const project = ProjectHelper.getProjectById(projectId)

    const skillIsFromLoggedUser = loggedUserId === userId
    const isGuide = !!ProjectHelper.getProjectById(projectId)?.parentTemplateId
    const hideCreateNoteSection = isGuide && !skillIsFromLoggedUser

    return (
        <>
            {(() => {
                switch (selectedNavItem) {
                    case DV_TAB_SKILL_PROPERTIES:
                        return <SkillProperties projectId={projectId} accessGranted={userHasAccessToProject} />
                    case DV_TAB_SKILL_UPDATES:
                        return <RootViewFeedsSkills projectId={projectId} />
                    case DV_TAB_SKILL_BACKLINKS:
                        return (
                            <BacklinksView
                                project={project}
                                linkedParentObject={linkedParentObject}
                                externalStyle={{ marginHorizontal: 0 }}
                            />
                        )
                    case DV_TAB_SKILL_CHAT:
                        return (
                            <ChatBoard
                                chat={{ id: skillId, type: 'skills' }}
                                projectId={project.id}
                                chatTitle={extendedName}
                                assistantId={assistantId}
                                objectType={'skills'}
                            />
                        )
                    case DV_TAB_SKILL_NOTE:
                        return (
                            <NoteIntegration
                                project={project}
                                noteId={noteId}
                                objectId={skillId}
                                objectName={extendedName}
                                objectPrivacy={isPublicFor}
                                isFullscreen={isFullScreen}
                                setFullscreen={isFullScreen => {
                                    dispatch(setDvIsFullScreen(isFullScreen))
                                }}
                                objectType="skills"
                                hideCreateNoteSection={hideCreateNoteSection}
                                object={skillInDv}
                                creatorId={userId}
                            />
                        )
                }
            })()}
        </>
    )
}
