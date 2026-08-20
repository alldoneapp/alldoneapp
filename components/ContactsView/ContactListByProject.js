import React, { memo, useEffect, useMemo, useRef } from 'react'
import { View } from 'react-native'

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
import { CONTACT_STATUS_FILTER_UNASSIGNED } from '../ContactStatusFilters/contactStatusFilterConstants'
import NewContactSection from './NewContactSection'
import ContactMoreButton from '../UIComponents/FloatModals/MorePopupsOfMainViews/Contacts/ContactMoreButton'
import ContactsHeader from './ContactsHeader'
import ContactStatusFiltersView from '../ContactStatusFilters/ContactStatusFiltersView'
import ContactsListSkeleton from './ContactsListSkeleton'
import { resolveGhostRowCount } from '../UIComponents/Ghosts/ghostRowCount'
import usePagedReveal from '../../hooks/usePagedReveal'
import useProjectData from '../../hooks/useProjectData'
import { PROJECT_DATA_CONTACTS } from '../../utils/InitialLoad/projectDataLoader'

const EMPTY_PROJECT_CONTACTS = {}

function ContactListByProject({ members, contacts, onlyMembers, projectIndex, firstProject, maxContactsToRender }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
    const handlesAddContactShortcut = inSelectedProject || firstProject
    const loggedUser = useSelector(state => (inSelectedProject ? state.loggedUser : null))
    const projectContacts = useSelector(state => (inSelectedProject ? state.projectContacts : EMPTY_PROJECT_CONTACTS))
    const lastAddNewContact = useSelector(state => (handlesAddContactShortcut ? state.lastAddNewContact : null))
    const [, filtersArray] = useSelectorHashtagFilters()
    const [contactStatusFilter] = useSelectorContactStatusFilter()
    const dispatch = useDispatch()

    const project = useSelector(state => state.loggedUserProjects[projectIndex])

    // AT-2386: belt and braces next to `ContactsView`'s sweep - this block also renders standalone
    // (single-project mode), where nothing else would have asked for the project's contacts.
    // Loading is idempotent inside the loader, so the two callers cost one watcher.
    useProjectData(project?.id, PROJECT_DATA_CONTACTS)

    const newItemRef = useRef(null)
    const dismissibleRefs = useRef({}).current

    useEffect(() => {
        if (handlesAddContactShortcut) dispatch(setLastAddNewContact({ projectId: project.id }))
    }, [handlesAddContactShortcut, project.id])

    useEffect(() => {
        if (!handlesAddContactShortcut) return
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [handlesAddContactShortcut, lastAddNewContact, project.id])

    const contactsList = useMemo(() => {
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
            newContacts =
                contactStatusFilter === CONTACT_STATUS_FILTER_UNASSIGNED
                    ? newContacts.filter(contact => !contact.contactStatusId)
                    : newContacts.filter(contact => contact.contactStatusId === contactStatusFilter)
        }

        const list = onlyMembers ? [...newMembers] : [...newMembers, ...newContacts]
        return list.sort((a, b) => ContactsHelper.sortContactsFn(a, b, project.id))
    }, [filtersArray, contactStatusFilter, members, contacts, onlyMembers, project.id])

    // AT-2385 - the whole project contact set is already in redux, so "show more" never
    // waited on the network; it flipped a boolean that mounted EVERY remaining contact in
    // one press. Each of those rows opens its own backlinks watcher and subscribes to the
    // store, so that press was the expensive operation. Reveal one page at a time instead,
    // and ghost the page while it mounts - the same affordance the other lists got in
    // AT-2382, driven by a signal that fits an in-memory list. See hooks/usePagedReveal.js.
    const { visibleAmount, incomingCount, loadingMore, expanded, canExpand, expand, collapse } = usePagedReveal(
        contactsList.length,
        maxContactsToRender,
        { initialAmount: maxContactsToRender }
    )

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
                projectIndex={project.index}
                projectId={project.id}
                customRight={
                    inSelectedProject ? (
                        <ContactMoreButton
                            projectId={project.id}
                            user={loggedUser}
                            wrapperStyle={localStyles.moreButtonWrapper}
                            buttonStyle={localStyles.moreButton}
                            iconSize={16}
                        />
                    ) : null
                }
                showRootSectionNavigation={inSelectedProject}
            />
            {inSelectedProject && <ContactsHeader contactAmount={contactsList.length} />}
            {inSelectedProject && <ContactStatusFiltersView projectContacts={projectContacts} />}

            <NewContactSection projectIndex={projectIndex} newItemRef={newItemRef} dismissibleRefs={dismissibleRefs} />

            {contactsList.length > 0 &&
                contactsList.map((contact, index) => {
                    return (
                        contact &&
                        index < visibleAmount && (
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
                                        projectId={project.id}
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

            {loadingMore && (
                <ContactsListSkeleton
                    rowCount={resolveGhostRowCount(incomingCount)}
                    contactKeys={contactsList.slice(visibleAmount, visibleAmount + incomingCount).map(c => c.uid)}
                />
            )}

            {(canExpand || expanded) && (
                <ShowMoreButton expanded={expanded} contract={collapse} expand={expand} loading={loadingMore} />
            )}
        </View>
    ) : null
}

export default memo(ContactListByProject)

const localStyles = {
    moreButtonWrapper: {
        marginTop: 3,
        marginLeft: 2,
    },
    moreButton: {
        width: 18,
        height: 18,
        minWidth: 18,
        minHeight: 18,
    },
}
