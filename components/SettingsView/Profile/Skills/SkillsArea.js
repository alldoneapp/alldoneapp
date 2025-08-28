import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import SkillsHeader from './SkillsHeader'
import SkillsProperties from './SkillsProperties/SkillsProperties'
import SkillsAllProjects from './SkillsAllProjects'
import useInProfileSettings from '../useInProfileSettings'
import { setActiveDragSkillModeId } from '../../../../redux/actions'
import store from '../../../../redux/store'
import { setForceCloseSkillEditionId } from '../../../../redux/actions'
import SkillsSelectedProject from './SkillsSelectedProject'
import EmptySkillsArea from './EmptySkillsArea'

export default function SkillsArea({ projectId, userId }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const forceCloseSkillEditionId = useSelector(state => state.forceCloseSkillEditionId)
    const amountOfSkills = useSelector(state => state.skillsByProject.total)
    const inSettings = useInProfileSettings()
    const dismissibleRefs = useRef({})

    const isSkillsOwner = !isAnonymous && userId === loggedUserId

    const setDismissibleRefs = (ref, dismissibleId) => {
        if (ref) dismissibleRefs.current[dismissibleId] = ref
    }

    const closeEdition = dismissibleId => {
        dismissibleRefs.current[dismissibleId].closeModal()
    }

    const closeAllEdition = () => {
        for (let dismissibleId in dismissibleRefs.current) {
            if (dismissibleRefs.current[dismissibleId].modalIsVisible()) closeEdition(dismissibleId)
        }
    }

    const checkIfAnyDismissibleIsOpen = () => {
        for (let dismissibleId in dismissibleRefs.current) {
            if (dismissibleRefs.current[dismissibleId].modalIsVisible()) return true
        }
        return false
    }

    const openEdition = dismissibleId => {
        const { showFloatPopup } = store.getState()
        if (showFloatPopup === 0) closeAllEdition()
        if (!checkIfAnyDismissibleIsOpen()) dismissibleRefs.current[dismissibleId].openModal()
    }

    useEffect(() => {
        if (dismissibleRefs.current[forceCloseSkillEditionId]) {
            closeEdition(forceCloseSkillEditionId)
            dispatch(setForceCloseSkillEditionId(''))
        }
    }, [forceCloseSkillEditionId])

    useEffect(() => {
        return () => {
            dispatch(setActiveDragSkillModeId(null))
        }
    }, [])

    return (
        <View style={(localStyles.container, inSettings || isSkillsOwner || !!amountOfSkills) && { marginTop: 70 }}>
            {(isSkillsOwner || !!amountOfSkills) && <SkillsHeader projectId={projectId} userId={userId} />}
            {isSkillsOwner && <SkillsProperties projectId={projectId} />}
            {inSettings ? (
                <SkillsAllProjects
                    setDismissibleRefs={setDismissibleRefs}
                    closeEdition={closeEdition}
                    closeAllEdition={closeAllEdition}
                    openEdition={openEdition}
                />
            ) : (
                <SkillsSelectedProject
                    projectId={projectId}
                    userId={userId}
                    setDismissibleRefs={setDismissibleRefs}
                    closeEdition={closeEdition}
                    closeAllEdition={closeAllEdition}
                    openEdition={openEdition}
                />
            )}
            {inSettings && <EmptySkillsArea />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: { flex: 1 },
})
