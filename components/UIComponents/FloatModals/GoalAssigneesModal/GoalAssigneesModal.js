import React, { useState, useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import AssigneeItem from './AssigneeItem'
import Button from '../../../UIControls/Button'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import useWindowSize from '../../../../utils/useWindowSize'
import { CAPACITY_NONE } from '../../../GoalsView/GoalsHelper'
import GoalAssigneeCapacityModal from '../GoalAssigneeCapacityModal/GoalAssigneeCapacityModal'
import { translate } from '../../../../i18n/TranslationService'
import { isWorkstream } from '../../../Workstreams/WorkstreamHelper'
import { filterContactsByPrivacy } from '../../../ContactsView/Utils/ContactsHelper'
import TabsHeader, { TEAM_MEMBERS_TAB } from './TabsHeader'
import SearchForm from '../AssigneeAndObserversModal/Form/SearchForm'
import { filterUserShapesByText } from '../AssigneeAndObserversModal/AssigneeAndObserversModal'
import EmptyResults from '../EmptyResults'

export default function GoalAssigneesModal({
    projectId,
    closeModal,
    updateAssignees,
    initialSelectedAssigeesIds,
    initialSelectedAssigeesCapacity,
}) {
    const projectIndex = ProjectHelper.getProjectIndexById(projectId)
    const [width, height] = useWindowSize()
    const [filterText, setFilterText] = useState('')
    const loggedUser = useSelector(state => state.loggedUser)
    const workstreams = useSelector(state => state.projectWorkstreams[projectId])
    const users = useSelector(state => state.projectUsers[projectId])
    const contacts = useSelector(state => state.projectContacts[projectId])
    const [showCapacityModalForAssigneeId, setShowCapacityModalForAssigneeId] = useState('')
    const [selectedAssigeesIds, setSelectedAssigeesIds] = useState(initialSelectedAssigeesIds)
    const [selectedAssigeesCapacity, setSelectedAssigeesCapacity] = useState(initialSelectedAssigeesCapacity)
    const [activeTab, setActiveTab] = useState(TEAM_MEMBERS_TAB)

    const offsets = useRef({ top: 0, bottom: 0 })
    const scrollHeight = useRef(0)
    const scrollRef = useRef()

    const usersFiltered = filterUserShapesByText(users, projectIndex, filterText)
    const workstreamsFiltered = filterUserShapesByText(workstreams, projectIndex, filterText)
    const contactsFiltered = filterUserShapesByText(
        filterContactsByPrivacy(contacts, loggedUser),
        projectIndex,
        filterText
    )

    const usersOrContacts =
        activeTab === TEAM_MEMBERS_TAB ? [...workstreamsFiltered, ...usersFiltered] : contactsFiltered

    const openCapacityModal = assigneId => {
        setShowCapacityModalForAssigneeId(assigneId)
        if (!selectedAssigeesIds.includes(assigneId)) {
            toggleSelection(false, assigneId)
        }
    }

    const closeCapacityModal = () => {
        setShowCapacityModalForAssigneeId('')
    }

    const updateCapacity = capacity => {
        const updatedCapacity = { ...selectedAssigeesCapacity }
        updatedCapacity[showCapacityModalForAssigneeId] = capacity
        setSelectedAssigeesCapacity(updatedCapacity)
    }

    const toggleSelection = (isSelected, userId) => {
        if (!isSelected || selectedAssigeesIds.length > 1) {
            const currentAssingeesAreWorkstreams = isWorkstream(selectedAssigeesIds[0])
            const currentIdIsFromWorkstream = isWorkstream(userId)
            const areSameKindOfAssignees = currentAssingeesAreWorkstreams === currentIdIsFromWorkstream

            if (areSameKindOfAssignees) {
                setSelectedAssigeesCapacity(selectedCapacity => {
                    const updatedCapacity = { ...selectedCapacity }
                    isSelected ? delete updatedCapacity[userId] : (updatedCapacity[userId] = CAPACITY_NONE)
                    return updatedCapacity
                })
                setSelectedAssigeesIds(selectedIds =>
                    isSelected ? selectedIds.filter(id => id !== userId) : [...selectedIds, userId]
                )
            } else {
                setSelectedAssigeesCapacity({ [userId]: CAPACITY_NONE })
                setSelectedAssigeesIds([userId])
            }
        }
    }

    const selectAssignees = () => {
        updateAssignees(selectedAssigeesIds, selectedAssigeesCapacity)
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') {
            selectAssignees()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    const onLayout = data => {
        scrollRef.current.scrollTo({ y: 0, animated: false })
        offsets.current = { top: 0, bottom: data.nativeEvent.layout.height }
        scrollHeight.current = data.nativeEvent.layout.height
    }

    const title = 'Goal assignees & capacity'
    const description = 'Select the users who will take care of this goal and their capacities'

    const tmpHeight = height - MODAL_MAX_HEIGHT_GAP
    const finalHeight = tmpHeight < 548 ? tmpHeight : 548

    return showCapacityModalForAssigneeId !== '' ? (
        <GoalAssigneeCapacityModal
            capacitySelected={selectedAssigeesCapacity[showCapacityModalForAssigneeId]}
            closeModal={closeCapacityModal}
            closeModalForButtonX={closeModal}
            updateCapacity={updateCapacity}
            assigneeId={showCapacityModalForAssigneeId}
            showBackButton={true}
            projectId={projectId}
        />
    ) : (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: finalHeight }]}>
            <ModalHeader closeModal={closeModal} title={translate(title)} description={translate(description)} />
            <View style={{ minHeight: 40 }}>
                <SearchForm setText={setFilterText} />
            </View>
            <TabsHeader
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                usersAmount={filterText ? [...workstreamsFiltered, ...users].length : 0}
                contactsAmount={filterText ? contactsFiltered.length : 0}
            />
            {usersOrContacts.length > 0 && (
                <CustomScrollView
                    ref={scrollRef}
                    indicatorStyle={{ right: -10 }}
                    scrollOnLayout={onLayout}
                    onScroll={({ nativeEvent }) => {
                        const y = nativeEvent.contentOffset.y
                        offsets.current = { top: y, bottom: y + scrollHeight.current }
                    }}
                >
                    {usersOrContacts.map(user => {
                        const isSelected = selectedAssigeesIds.includes(user.uid)
                        return (
                            <View key={user.uid}>
                                {isSelected && <View style={localStyles.selectedItemBackground} />}
                                <AssigneeItem
                                    key={user.uid}
                                    user={user}
                                    toggleSelection={toggleSelection}
                                    isSelected={isSelected}
                                    capacityKey={isSelected ? selectedAssigeesCapacity[user.uid] : CAPACITY_NONE}
                                    openCapacityModal={openCapacityModal}
                                />
                            </View>
                        )
                    })}
                </CustomScrollView>
            )}
            {usersOrContacts.length === 0 && <EmptyResults />}
            <View style={localStyles.line} />
            <View style={localStyles.buttonContainer}>
                <Button title={translate('Done save')} type="primary" onPress={selectAssignees} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        padding: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    line: {
        height: 1,
        backgroundColor: colors.Text03,
        opacity: 0.2,
        marginTop: 8,
        marginHorizontal: -16,
    },
    buttonContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
    },
    selectedItemBackground: {
        position: 'absolute',
        left: -8,
        top: 0,
        right: -8,
        bottom: 0,
        backgroundColor: colors.Text03,
        opacity: 0.16,
        borderRadius: 4,
    },
})
