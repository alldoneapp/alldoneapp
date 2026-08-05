import React, { useEffect, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import ContactStatusItem from './ContactStatusItem'
import AddNewContactStatus from './AddNewContactStatus'
import EditContactStatus from './EditContactStatus'
import DismissibleItem from '../../../UIComponents/DismissibleItem'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { translate } from '../../../../i18n/TranslationService'
import { BatchWrapper } from '../../../../functions/BatchWrapper/batchWrapper'
import { generateSortIndex, getDb } from '../../../../utils/backends/firestore'
import { updateContactStatusSortIndex } from '../../../../utils/backends/Projects/contactStatusFirestore'
import URLsProjects, { URL_PROJECT_DETAILS_CONTACT_STATUSES } from '../../../../URLSystem/Projects/URLsProjects'
import { DV_TAB_PROJECT_CONTACT_STATUSES } from '../../../../utils/TabNavigationConstants'

const ContactStatusSettings = ({ project }) => {
    const newItemRef = useRef(null)
    const dismissibleRefs = useRef([])
    const selectedTab = useSelector(state => state.selectedNavItem)
    const wasDraggingRef = useRef(false)

    useEffect(() => {
        if (selectedTab === DV_TAB_PROJECT_CONTACT_STATUSES) {
            URLsProjects.push(URL_PROJECT_DETAILS_CONTACT_STATUSES, null, project.id)
        }
    }, [])

    const statuses = project.contactStatuses ? Object.values(project.contactStatuses) : []
    const sortedStatuses = [...statuses].sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0))

    const sortStatuses = (statuses, startIndex, endIndex) => {
        const sortedList = [...statuses]
        const [removed] = sortedList.splice(startIndex, 1)
        sortedList.splice(endIndex, 0, removed)
        return sortedList
    }

    const closeAllModals = () => {
        for (let i = 0; i < sortedStatuses.length; ++i) {
            dismissibleRefs?.current[i]?.closeModal()
        }
        newItemRef.current?.closeModal()
    }

    const onDragStart = () => {
        closeAllModals()
    }

    const onDragEnd = result => {
        wasDraggingRef.current = true
        setTimeout(() => {
            wasDraggingRef.current = false
        }, 100)

        closeAllModals()

        const { destination, source } = result
        if (!destination || destination.index === source.index) {
            return
        }

        const newSortedList = sortStatuses(sortedStatuses, source.index, destination.index)

        const batch = new BatchWrapper(getDb())
        for (let i = 0; i < newSortedList.length; i++) {
            const status = newSortedList[i]
            const sortIndex = generateSortIndex()
            updateContactStatusSortIndex(project.id, status.id, sortIndex, batch)
        }
        batch.commit()
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Contact Statuses')}</Text>
                <Text style={[styles.caption2, { color: colors.Text03, marginLeft: 8 }]}>{sortedStatuses.length}</Text>
            </View>

            <View style={localStyles.infoContainer}>
                <Icon name="info" size={16} color={colors.Text03} style={{ alignSelf: 'center' }} />
                <View style={{ marginLeft: 8 }}>
                    <Text style={[styles.caption2, { color: colors.Text03 }]}>
                        {translate('Define statuses that can be assigned to contacts in this project')}
                    </Text>
                </View>
            </View>

            <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
                <Droppable droppableId="contact-statuses" type="statuses">
                    {(provided, snapshot) => (
                        <div ref={provided.innerRef} {...provided.droppableProps}>
                            <View
                                style={[
                                    localStyles.statusesContainer,
                                    snapshot.isDraggingOver && localStyles.draggingOver,
                                ]}
                            >
                                {sortedStatuses.map((status, index) => (
                                    <Draggable key={status.id} draggableId={status.id} index={index}>
                                        {(provided, snapshot) => (
                                            <div ref={provided.innerRef} {...provided.draggableProps}>
                                                <DismissibleItem
                                                    ref={ref => {
                                                        dismissibleRefs.current[index] = ref
                                                    }}
                                                    defaultComponent={
                                                        <TouchableOpacity
                                                            onPress={() => {
                                                                if (wasDraggingRef.current) return
                                                                closeAllModals()
                                                                dismissibleRefs?.current[index]?.openModal()
                                                            }}
                                                        >
                                                            <ContactStatusItem
                                                                status={status}
                                                                dragHandleProps={provided.dragHandleProps}
                                                                isDragging={snapshot.isDragging}
                                                            />
                                                        </TouchableOpacity>
                                                    }
                                                    modalComponent={
                                                        <EditContactStatus
                                                            status={status}
                                                            projectId={project.id}
                                                            formType={'edit'}
                                                            onCancelAction={() => {
                                                                dismissibleRefs?.current[index]?.toggleModal()
                                                            }}
                                                        />
                                                    }
                                                />
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </View>
                        </div>
                    )}
                </Droppable>
            </DragDropContext>

            <View>
                <DismissibleItem
                    ref={ref => {
                        newItemRef.current = ref
                    }}
                    defaultComponent={
                        <AddNewContactStatus
                            onPress={() => {
                                closeAllModals()
                                newItemRef?.current?.toggleModal()
                            }}
                        />
                    }
                    modalComponent={
                        <EditContactStatus
                            projectId={project.id}
                            formType={'new'}
                            onCancelAction={() => {
                                newItemRef?.current?.toggleModal()
                            }}
                        />
                    }
                />
            </View>
        </View>
    )
}

export default ContactStatusSettings

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'column',
    },
    header: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    infoContainer: {
        flexDirection: 'row',
        height: 40,
        paddingTop: 8,
        paddingBottom: 12,
    },
    statusesContainer: {
        flexDirection: 'column',
        marginBottom: 8,
    },
    draggingOver: {
        backgroundColor: colors.Grey100,
        borderRadius: 4,
    },
})
