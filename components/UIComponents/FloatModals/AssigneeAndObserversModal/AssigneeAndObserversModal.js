import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import { sortBy } from 'lodash'

import useWindowSize from '../../../../utils/useWindowSize'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { colors } from '../../../styles/global'
import Header, { ASSIGNEE_TAB, OBSERVERS_TAB } from './Header/Header'
import SearchForm from './Form/SearchForm'
import ContactList from './List/ContactList'
import EmptyResults from '../EmptyResults'
import ContactsHelper, { filterContactsByPrivacy } from '../../../ContactsView/Utils/ContactsHelper'
import Button from '../../../UIControls/Button'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import { ASSIGNEE_PICKER_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { getWorkstreamInProject } from '../../../Workstreams/WorkstreamHelper'
import { translate } from '../../../../i18n/TranslationService'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import ModalHeader from '../ModalHeader'

export default function AssigneeAndObserversModal({
    projectIndex,
    object,
    closePopover,
    saveDataBeforeSaveObject,
    delayClosePopover,
    onSaveData,
    headerText,
    subheaderText,
    inEditTask,
    directAssigneeComment,
}) {
    const project = ProjectHelper.getProjectByIndex(projectIndex)
    const isGuide = !!project.parentTemplateId

    const [width, height] = useWindowSize()
    const [selectedAssignee, setSelectedAssignee] = useState(null)
    const [selectedObservers, setSelectedObservers] = useState(new Map())
    const [assigneeIsContact, setAssigneeIsContact] = useState(false)
    const [filterText, setFilterText] = useState('')
    const [activeTab, setActiveTab] = useState(isGuide ? OBSERVERS_TAB : ASSIGNEE_TAB)
    const workstreams = useSelector(state => state.projectWorkstreams[project.id])
    const users = useSelector(state => state.projectUsers[project.id])
    const contacts = useSelector(state => state.projectContacts[project.id])

    const loggedUser = useSelector(state => state.loggedUser)

    const usersFiltered = filterUserShapesByText(users, projectIndex, filterText)
    const workstreamsFiltered = filterUserShapesByText(workstreams, projectIndex, filterText)
    const contactsFiltered = filterUserShapesByText(
        filterContactsByPrivacy(contacts, loggedUser),
        projectIndex,
        filterText
    )

    const sortedAssignees = [
        ...sortBy(workstreamsFiltered, [item => item.displayName.toLowerCase()]),
        ...sortBy(usersFiltered, [item => item.displayName.toLowerCase()]),
        ...sortBy(contactsFiltered, [item => item.displayName.toLowerCase()]),
    ]

    const canShowAllObservers = !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(project.id)

    let possibleObserver = usersFiltered
    if (!canShowAllObservers) possibleObserver = possibleObserver.filter(user => user.uid === loggedUser.uid)
    const sortedObservers = sortBy(possibleObserver, [item => item.displayName.toLowerCase()])
    const finalContactList = activeTab === ASSIGNEE_TAB ? sortedAssignees : sortedObservers

    const isSubtask = !!object.parentId

    const header =
        headerText ||
        (isSubtask
            ? translate('Choose assignee')
            : isGuide
            ? translate('Choose observers')
            : translate('Choose assignee and observers'))
    const subheader =
        subheaderText ||
        (isSubtask
            ? translate('Select here the assignee subheader')
            : isGuide
            ? translate('Select here the observer subheader')
            : translate('Select here the assignee and observers subheader'))

    const tmpHeight = height - MODAL_MAX_HEIGHT_GAP
    const finalHeight = tmpHeight < 548 ? tmpHeight : 548

    const changeTab = tab => {
        if (activeTab !== tab) {
            setActiveTab(tab)
        }
    }

    const onSelectContact = (contact, tab) => {
        if (tab === ASSIGNEE_TAB) {
            setSelectedAssignee(contact)
            let tmpObservers = new Map(cleanObservers(contact, selectedObservers))
            if (contact.recorderUserId && tmpObservers.size === 0 && !tmpObservers.has(loggedUser.uid)) {
                tmpObservers.set(loggedUser.uid, loggedUser)
            }
            setSelectedObservers(tmpObservers)
            // setClickOnAssignee(true)
        } else {
            let tmpObservers = new Map(selectedObservers)
            if (!tmpObservers.has(contact.uid)) {
                tmpObservers.set(contact.uid, contact)
            } else {
                tmpObservers.delete(contact.uid)
            }
            tmpObservers = cleanObservers(selectedAssignee, tmpObservers)
            setSelectedObservers(tmpObservers)
        }
    }

    const isValid = () => {
        return selectedAssignee != null && (!assigneeIsContact || selectedObservers.size > 0)
    }

    const onDone = (e, directEvent, directAssigneeComment) => {
        e?.preventDefault()
        e?.stopPropagation()

        const observers = Array.from(cleanObservers(selectedAssignee, selectedObservers).values())

        if (saveDataBeforeSaveObject) {
            directEvent ? closePopover() : delayClosePopover()
            saveDataBeforeSaveObject(selectedAssignee, observers, directAssigneeComment)
        } else {
            onSaveData(selectedAssignee, observers)
        }
        return false
    }

    const cleanObservers = (user, observerList) => {
        if (observerList.has(user.uid)) {
            const tmpObservers = new Map(observerList)
            tmpObservers.delete(user.uid)
            return tmpObservers
        }
        return observerList
    }

    const onDirectAssigneeComment = async e => {
        onDone(e, false, true)
    }

    const onAssigneeComment = async e => {
        onDone(e, false, false)
        setTimeout(() => {
            updateTask(e, false, false, true)
        }, 1000)
    }

    useEffect(() => {
        const user =
            TasksHelper.getUserInProject(project.id, object.userId) ||
            TasksHelper.getContactInProject(project.id, object.userId) ||
            getWorkstreamInProject(project.id, object.userId)
        setSelectedAssignee(user)
        setSelectedObservers(
            cleanObservers(
                user,
                new Map(
                    object.observersIds
                        ? object.observersIds.map(uid => [uid, TasksHelper.getUserInProject(project.id, uid)])
                        : []
                )
            )
        )
    }, [])

    useEffect(() => {
        setAssigneeIsContact(isAssigneeContact(selectedAssignee?.uid, contacts))
    }, [selectedAssignee])

    const onPressEnter = e => {
        if (e.key === 'Enter') {
            e?.preventDefault()
            e?.stopPropagation()
            setTimeout(() => onDone(null, true, false), 100)
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
                <ModalHeader title={header} description={subheader} closeModal={closePopover} />
                <SearchForm setText={setFilterText} blurOnArrow={true} />

                {!isSubtask && !isGuide && (
                    <Header
                        setTab={changeTab}
                        filterText={filterText}
                        assigneesList={sortedAssignees}
                        observersList={sortedObservers}
                    />
                )}
            </View>

            <View style={[localStyles.body, (isSubtask || isGuide) && { marginTop: 16 }]}>
                {finalContactList.length > 0 ? (
                    <ContactList
                        tab={activeTab}
                        setTab={changeTab}
                        projectIndex={projectIndex}
                        contactList={finalContactList}
                        onSelectContact={onSelectContact}
                        selectedAssignee={selectedAssignee}
                        selectedObservers={selectedObservers}
                        hideAssigneeTab={isGuide}
                    />
                ) : (
                    <EmptyResults />
                )}
            </View>

            <View style={localStyles.sectionSeparator} />

            <View style={localStyles.bottomSection}>
                {inEditTask && (
                    <Button
                        disabled={!isValid()}
                        title={translate('Assign & Comment')}
                        type="secondary"
                        onPress={directAssigneeComment ? onDirectAssigneeComment : onAssigneeComment}
                    />
                )}
                <Button
                    disabled={!isValid()}
                    title={translate('Assign')}
                    type="primary"
                    buttonStyle={{ marginLeft: 8 }}
                    onPress={e => {
                        onDone(e, false, false)
                    }}
                    shortcutText={'Enter'}
                />
            </View>
        </View>
    )
}

export const filterUserShapesByText = (usersList, projectIndex, filterText) => {
    return filterText.trim()
        ? usersList.filter(user => ContactsHelper.matchContactSearch(user, filterText, projectIndex))
        : usersList
}

const isAssigneeContact = (contactUid, contacts) => {
    return contacts.findIndex(item => item.uid === contactUid) >= 0
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
    closeContainer: {
        position: 'absolute',
        top: -8,
        right: 8,
    },
    closeSubContainer: {
        width: 24,
        height: 24,
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
