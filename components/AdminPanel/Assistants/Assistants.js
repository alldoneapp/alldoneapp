import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import URLsAdminPanel, { URL_ADMIN_PANEL_ASSISTANTS } from '../../../URLSystem/AdminPanel/URLsAdminPanel'
import Header from './Header'
import AddAssistant from './AddAssistant'
import store from '../../../redux/store'
import AssistantsList from './AssistantsList'
import AssistantsFilter from './AssistantsFilter'
import { GLOBAL_PROJECT_ID } from './assistantsHelper'
import NavigationService from '../../../utils/NavigationService'
import { setSelectedNavItem } from '../../../redux/actions'
import { DV_TAB_ASSISTANT_CUSTOMIZATIONS } from '../../../utils/TabNavigationConstants'

export default function Assistants({}) {
    const dispatch = useDispatch()
    const globalAssistants = useSelector(state => state.globalAssistants)
    const [filter, setFilter] = useState('')
    const dismissibleRefs = useRef({})

    const setDismissibleRefs = (ref, dismissibleId) => {
        if (ref) dismissibleRefs.current[dismissibleId] = ref
    }

    const openEdition = dismissibleId => {
        const { showFloatPopup } = store.getState()
        if (showFloatPopup === 0) closeAllEdition()
        if (!checkIfAnyDismissibleIsOpen()) dismissibleRefs.current[dismissibleId].openModal()
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

    const navigateToDv = assistant => {
        const { showFloatPopup } = store.getState()
        if (showFloatPopup === 0) {
            NavigationService.navigate('AssistantDetailedView', {
                assistantId: assistant.uid,
                assistant,
                projectId: GLOBAL_PROJECT_ID,
            })
            dispatch(setSelectedNavItem(DV_TAB_ASSISTANT_CUSTOMIZATIONS))
        }
    }

    useEffect(() => {
        URLsAdminPanel.push(URL_ADMIN_PANEL_ASSISTANTS)
    }, [])

    const filteredAssistants = filter
        ? globalAssistants.filter(assistant => assistant.displayName.toUpperCase().includes(filter.toUpperCase()))
        : globalAssistants

    return (
        <View style={localStyles.container}>
            <Header assistantsAmount={filteredAssistants.length} />
            <AssistantsFilter filter={filter} setFilter={setFilter} />
            <AddAssistant
                projectId={GLOBAL_PROJECT_ID}
                setDismissibleRefs={setDismissibleRefs}
                openEdition={openEdition}
                closeEdition={closeEdition}
            />
            <AssistantsList
                projectId={GLOBAL_PROJECT_ID}
                assistants={filteredAssistants}
                setDismissibleRefs={setDismissibleRefs}
                closeEdition={closeEdition}
                onAssistantClick={navigateToDv}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        marginBottom: 48,
    },
})
