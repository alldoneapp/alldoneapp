import React, { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { sortBy } from 'lodash'
import { StyleSheet, View } from 'react-native'

import useWindowSize from '../../../../utils/useWindowSize'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { colors } from '../../../styles/global'
import SearchForm from './Form/SearchForm'
import ContactList from './List/ContactList'
import EmptyResults from '../EmptyResults'
import ContactsHelper from '../../../ContactsView/Utils/ContactsHelper'
import Button from '../../../UIControls/Button'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import { ASSIGNEE_PICKER_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { translate } from '../../../../i18n/TranslationService'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import ModalHeader from '../ModalHeader'
import { OBSERVERS_TAB } from './Header/Header'
import { getAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'
import { filterUserShapesByText } from './AssigneeAndObserversModal'

export default function ObserversModal({
    projectIndex,
    task,
    closePopover,
    saveDataBeforeSaveObject,
    delayClosePopover,
    onSaveData,
}) {
    const project = ProjectHelper.getProjectByIndex(projectIndex)
    const [selectedObservers, setSelectedObservers] = useState(new Map())
    const [filterText, setFilterText] = useState('')
    const users = useSelector(state => state.projectUsers[project.id])
    const loggedUser = useSelector(state => state.loggedUser)

    const [width, height] = useWindowSize()

    const canShowAllObservers = !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(project.id)

    const usersFiltered = filterUserShapesByText(users, projectIndex, filterText)

    let possibleObserver = usersFiltered
    if (!canShowAllObservers) possibleObserver = possibleObserver.filter(user => user.uid === loggedUser.uid)
    const sortedObservers = sortBy(possibleObserver, [item => item.displayName.toLowerCase()])

    const tmpHeight = height - MODAL_MAX_HEIGHT_GAP
    const finalHeight = tmpHeight < 548 ? tmpHeight : 548

    const onSelectContact = (contact, tab) => {
        let tmpObservers = new Map(selectedObservers)
        if (!tmpObservers.has(contact.uid)) {
            tmpObservers.set(contact.uid, contact)
        } else {
            tmpObservers.delete(contact.uid)
        }

        setSelectedObservers(tmpObservers)
    }

    const onDone = (e, directEvent = false) => {
        e?.preventDefault()
        e?.stopPropagation()

        const observers = Array.from(selectedObservers.values())

        const assignee = getAssistant(task.userId)

        if (saveDataBeforeSaveObject) {
            directEvent ? closePopover() : delayClosePopover()
            saveDataBeforeSaveObject(assignee, observers)
        } else {
            onSaveData?.(assignee, observers)
        }
    }

    useEffect(() => {
        setSelectedObservers(
            new Map(
                task.observersIds
                    ? task.observersIds.map(uid => [uid, TasksHelper.getUserInProject(project.id, uid)])
                    : []
            )
        )
    }, [])

    const onPressEnter = e => {
        if (e.key === 'Enter') {
            e?.preventDefault()
            e?.stopPropagation()
            setTimeout(() => onDone(null, true), 100)
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onPressEnter)
        return () => document.removeEventListener('keydown', onPressEnter)
    })

    useEffect(() => {
        storeModal(ASSIGNEE_PICKER_MODAL_ID)
        return () => {
            removeModal(ASSIGNEE_PICKER_MODAL_ID)
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: finalHeight }]}>
            <View style={localStyles.heading}>
                <ModalHeader
                    title={translate('Choose observers')}
                    description={translate('Select here the observer subheader')}
                    closeModal={closePopover}
                />
                <SearchForm setText={setFilterText} blurOnArrow={true} />
            </View>

            <View style={[localStyles.body, { marginTop: 16 }]}>
                {sortedObservers.length > 0 ? (
                    <ContactList
                        projectIndex={projectIndex}
                        contactList={sortedObservers}
                        onSelectContact={onSelectContact}
                        selectedObservers={selectedObservers}
                        hideAssigneeTab={true}
                        tab={OBSERVERS_TAB}
                    />
                ) : (
                    <EmptyResults />
                )}
            </View>

            <View style={localStyles.sectionSeparator} />

            <View style={localStyles.bottomSection}>
                <Button
                    title={translate('Assign')}
                    type="primary"
                    buttonStyle={{ marginLeft: 8 }}
                    onPress={onDone}
                    shortcutText={'Enter'}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    heading: {
        paddingHorizontal: 16,
    },
    body: {
        flex: 1,
        paddingHorizontal: 8,
    },
    title: {
        flexDirection: 'column',
        marginBottom: 20,
    },
    sectionSeparator: {
        height: 1,
        width: '100%',
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginVertical: 16,
    },
    bottomSection: {
        flex: 1,
        minHeight: 40,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
})
