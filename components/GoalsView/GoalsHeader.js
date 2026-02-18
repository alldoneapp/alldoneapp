import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'

import styles from '../styles/global'
import { GOALS_OPEN_TAB_INDEX } from './GoalsHelper'
import GoalMoreButton from '../UIComponents/FloatModals/MorePopupsOfMainViews/Goals/GoalMoreButton'
import { translate } from '../../i18n/TranslationService'
import ChangeObjectListModal from '../UIComponents/FloatModals/ChangeObjectListModal'
import Shortcut from '../UIControls/Shortcut'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function GoalsHeader() {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const goalsActiveTab = useSelector(state => state.goalsActiveTab)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const realProjectIds = useSelector(state => state.loggedUser.realProjectIds)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const showShortcuts = useSelector(state => state.showShortcuts)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
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
            <Hotkeys
                disabled={blockShortcuts || !showShortcuts || showFloatPopup !== 0 || !accessGranted}
                keyName={'s,alt+s'}
                onKeyDown={openModal}
                filter={e => true}
            />
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
            {showShortcuts && showFloatPopup === 0 && accessGranted && !smallScreenNavigation && (
                <Shortcut text={'S'} containerStyle={localStyles.shortcut} />
            )}

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
    shortcut: {
        marginLeft: 8,
    },
})
