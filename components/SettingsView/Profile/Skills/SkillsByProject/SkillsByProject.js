import React, { useEffect } from 'react'
import { View } from 'react-native'
import v4 from 'uuid/v4'
import { useDispatch, useSelector } from 'react-redux'

import ResetSkills from './ResetSkills'
import ProjectHeader from '../../../../Premium/PremiumTab/FreePlanArea/ProjectHeader'
import SkillsList from './SkillsList'
import AddSkill from '../AddSkill/AddSkill'
import useActiveDragMode from '../useActiveDragMode'
import SortModeActiveInfo from '../../../../GoalsView/SortModeActiveInfo'
import {
    setSkillsByProject,
    setSkillsDefaultPrivacy,
    startLoadingData,
    stopLoadingData,
} from '../../../../../redux/actions'
import Backend from '../../../../../utils/BackendBridge'
import useInProfileSettings from '../../useInProfileSettings'
import { watchDefaultSkillsPrivacy } from '../../../../../utils/backends/Skills/skillsFirestore'

export default function SkillsByProject({
    projectId,
    userId,
    projectIndex,
    setDismissibleRefs,
    openEdition,
    closeEdition,
    closeAllEdition,
}) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const skillsAmount = useSelector(state =>
        state.skillsByProject[projectId] ? state.skillsByProject[projectId].length : 0
    )
    const activeDragMode = useActiveDragMode(projectId)
    const inSettings = useInProfileSettings()

    const isSkillsOwner = !isAnonymous && userId === loggedUserId

    useEffect(() => {
        const watcherKey = v4()
        dispatch(startLoadingData())
        Backend.watchSkills(projectId, userId, watcherKey)
        return () => {
            dispatch(setSkillsByProject(projectId, null))
            dispatch(stopLoadingData())
            Backend.unwatch(watcherKey)
        }
    }, [])

    useEffect(() => {
        if (isSkillsOwner) {
            const watcherKey = v4()
            watchDefaultSkillsPrivacy(projectId, loggedUserId, watcherKey)
            return () => {
                Backend.unwatch(watcherKey)
                dispatch(setSkillsDefaultPrivacy(projectId, null))
            }
        }
    }, [isSkillsOwner])

    return !inSettings || skillsAmount > 0 ? (
        <View>
            {inSettings && (
                <ProjectHeader
                    projectIndex={projectIndex}
                    containerStyle={{ paddingHorizontal: 0 }}
                    showSkillsMoreButton={true}
                    projectId={projectId}
                />
            )}
            <SkillsList
                projectId={projectId}
                setDismissibleRefs={setDismissibleRefs}
                openEdition={openEdition}
                closeEdition={closeEdition}
            />
            {isSkillsOwner ? (
                activeDragMode ? (
                    <SortModeActiveInfo />
                ) : (
                    <AddSkill
                        projectId={projectId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                    />
                )
            ) : null}
            {isSkillsOwner && skillsAmount > 0 && (
                <ResetSkills
                    projectId={projectId}
                    closeAllEdition={closeAllEdition}
                    containerStyle={inSettings && { marginBottom: 32 }}
                />
            )}
        </View>
    ) : null
}
