import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { cloneDeep } from 'lodash'

import store from '../../redux/store'
import ContactItem from './ContactItem'
import DismissibleItem from '../UIComponents/DismissibleItem'
import EditContact from './EditContact'
import { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { setLastAddNewContact } from '../../redux/actions'
import { dismissAllPopups, isInputsFocused } from '../../utils/HelperFunctions'
import ShowMoreButton from '../UIControls/ShowMoreButton'
import ProjectHeader from '../TaskListView/Header/ProjectHeader'
import ContactsHelper, { isSomeContactEditOpen } from './Utils/ContactsHelper'
import { useDispatch, useSelector } from 'react-redux'
import useSelectorHashtagFilters from '../HashtagFilters/UseSelectorHashtagFilters'
import { filterContacts } from '../HashtagFilters/FilterHelpers/FilterContacts'
import useSelectorContactStatusFilter from '../ContactStatusFilters/useSelectorContactStatusFilter'
import useShowNewCommentsBubbleInBoard from '../../hooks/Chats/useShowNewCommentsBubbleInBoard'
import NewContactSection from './NewContactSection'
import ContactListEmptyProject from './ContactListEmptyProject'

export default function ContactListByProject({
    members,
    contacts,
    onlyMembers,
    projectIndex,
    firstProject,
    maxContactsToRender,
    projectId,
}) {
    const [contactsList, setContactsList] = useState([])
    const [pressedShowMore, setPressedShowMore] = useState(false)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const lastAddNewContact = useSelector(state => state.lastAddNewContact)
    const [filters, filtersArray] = useSelectorHashtagFilters()
    const [contactStatusFilter] = useSelectorContactStatusFilter()
    const [filteredMembers, setFilteredMembers] = useState(cloneDeep(members))
    const [filteredContacts, setFilteredContacts] = useState(cloneDeep(contacts))
    const { showFollowedBubble, showUnfollowedBubble } = useShowNewCommentsBubbleInBoard(projectId)
    const dispatch = useDispatch()

    const project = loggedUserProjects[projectIndex]

    const newItemRef = useRef(null)
    const dismissibleRefs = useRef({}).current

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    useEffect(() => {
        buildContactsList()
        updateLastAddNewContact()
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    useEffect(() => {
        buildContactsList()
    }, [filteredMembers, filteredContacts, onlyMembers, pressedShowMore])

    useEffect(() => {
        let newMembers = members
        let newContacts = contacts

        // Apply hashtag filters
        if (filtersArray.length > 0) {
            newMembers = filterContacts(members, project.index)
            newContacts = filterContacts(contacts, project.index)
        }

        // Apply contact status filter (only to contacts, not members)
        // When filtering by contact status, hide members since they don't have statuses
        if (contactStatusFilter) {
            newMembers = []
            newContacts = newContacts.filter(contact => contact.contactStatusId === contactStatusFilter)
        }

        setFilteredMembers(cloneDeep(newMembers))
        setFilteredContacts(cloneDeep(newContacts))
        // Using plain "filtersArray" adds infinite re-renders here
    }, [JSON.stringify(filtersArray), contactStatusFilter, members, contacts])

    useEffect(() => {
        updateLastAddNewContact()
    }, [selectedProjectIndex])

    const buildContactsList = () => {
        const project = loggedUserProjects[projectIndex]
        let contactsList = filteredMembers

        if (!onlyMembers) {
            contactsList = contactsList.concat(filteredContacts)
        }

        contactsList.sort((a, b) => ContactsHelper.sortContactsFn(a, b, project.id))
        setContactsList(contactsList)
    }

    const updateLastAddNewContact = () => {
        if (inSelectedProject || firstProject) {
            dispatch(setLastAddNewContact({ projectId: project.id }))
        }
    }

    const onKeyDown = e => {
        if (!store.getState().blockShortcuts) {
            const { projectId: lastPId } = lastAddNewContact ? lastAddNewContact : { projectId: null }
            const shouldOpen = project.id === lastPId

            const dismissItems = document.querySelectorAll('[aria-label="dismissible-edit-item"]')
            if (e.key === '+' && dismissItems.length === 0 && !isInputsFocused() && shouldOpen) {
                e.preventDefault()
                e.stopPropagation()
                newItemRef?.current?.toggleModal()
            }
        }
    }

    return contactsList.length > 0 || inSelectedProject ? (
        <View style={{ marginBottom: inSelectedProject ? 32 : 25 }}>
            <ProjectHeader
                projectIndex={loggedUserProjects[projectIndex].index}
                projectId={loggedUserProjects[projectIndex].id}
            />

            <NewContactSection projectIndex={projectIndex} newItemRef={newItemRef} dismissibleRefs={dismissibleRefs} />

            {contactsList.length > 0 &&
                contactsList.map((contact, index) => {
                    return (
                        contact &&
                        (pressedShowMore || index < maxContactsToRender) && (
                            <DismissibleItem
                                key={contact.uid}
                                ref={ref => {
                                    if (ref) {
                                        dismissibleRefs[`${contact.uid}`] = ref
                                    }
                                }}
                                defaultComponent={
                                    <ContactItem
                                        projectIndex={projectIndex}
                                        key={contact.uid}
                                        contact={contact}
                                        isMember={!contact.hasOwnProperty('recorderUserId')} // Distinctive property of contacts
                                        onPress={() => {
                                            if (!isSomeContactEditOpen()) {
                                                for (let key in dismissibleRefs) {
                                                    dismissibleRefs[key].closeModal()
                                                }
                                                newItemRef.current?.closeModal()
                                                dismissibleRefs[`${contact.uid}`].openModal()
                                            } else {
                                                dismissAllPopups()
                                            }
                                        }}
                                    />
                                }
                                modalComponent={
                                    <EditContact
                                        isMember={!contact.hasOwnProperty('recorderUserId')} // Distinctive property of contacts
                                        projectId={loggedUserProjects[projectIndex].id}
                                        projectIndex={projectIndex}
                                        onCancelAction={() => dismissibleRefs[`${contact.uid}`].toggleModal()}
                                        contact={contact}
                                        dismissibleRef={dismissibleRefs[`${contact.uid}`]}
                                    />
                                }
                            />
                        )
                    )
                })}

            {maxContactsToRender < contactsList.length && (
                <ShowMoreButton
                    expanded={pressedShowMore}
                    contract={() => setPressedShowMore(false)}
                    expand={() => setPressedShowMore(true)}
                />
            )}
        </View>
    ) : showFollowedBubble || showUnfollowedBubble ? (
        <ContactListEmptyProject
            projectId={projectId}
            projectIndex={projectIndex}
            newItemRef={newItemRef}
            dismissibleRefs={dismissibleRefs}
        />
    ) : null
}
