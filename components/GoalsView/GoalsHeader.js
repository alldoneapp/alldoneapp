import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import styles from '../styles/global'
import { GOALS_OPEN_TAB_INDEX } from './GoalsHelper'
import GoalMoreButton from '../UIComponents/FloatModals/MorePopupsOfMainViews/Goals/GoalMoreButton'
import { translate } from '../../i18n/TranslationService'
import ChangeObjectListModal from '../UIComponents/FloatModals/ChangeObjectListModal'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function GoalsHeader() {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const goalsActiveTab = useSelector(state => state.goalsActiveTab)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const realProjectIds = useSelector(state => state.loggedUser.realProjectIds)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const [showModal, setShowModal] = useState(false)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const accessGranted = !isAnonymous && (inAllProjects || (project && realProjectIds.includes(project.id)))

    const closeModal = () => {
        setShowModal(false)
    }

    const openModal = () => {
        setShowModal(true)
    }

    return (
        <View style={localStyles.container}>
            <Popover
                content={<ChangeObjectListModal closePopover={closeModal} />}
                onClickOutside={closeModal}
                isOpen={showModal}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'start'}
                contentLocation={smallScreenNavigation ? null : undefined}
            >
                <TouchableOpacity disabled={!accessGranted} accessible={false} onPress={openModal}>
                    <Text style={localStyles.title}>{translate('Goals')}</Text>
                </TouchableOpacity>
            </Popover>

            {goalsActiveTab === GOALS_OPEN_TAB_INDEX && !isAnonymous && <GoalMoreButton />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        width: '100%',
        alignItems: 'center',
        height: 80,
        maxHeight: 80,
        paddingTop: 40,
        paddingBottom: 8,
    },
    title: {
        ...styles.title5,
    },
})
