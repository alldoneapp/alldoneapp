import React, { useEffect, useState } from 'react'
import useWindowSize from '../../../../utils/useWindowSize'
import { useDispatch, useSelector } from 'react-redux'
import { sortBy } from 'lodash'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import Hotkeys from 'react-hot-keys'
import { TouchableOpacity } from 'react-native-gesture-handler'
import Icon from '../../../Icon'
import SearchForm from '../AssigneeAndObserversModal/Form/SearchForm'
import ContactList from './List/ContactList'
import EmptyResults from '../EmptyResults'
import ContactsHelper from '../../../ContactsView/Utils/ContactsHelper'
import Button from '../../../UIControls/Button'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import { removeModal, storeModal, WORKSTREAM_MEMBERS_MODAL_ID } from '../../../ModalsManager/modalsManager'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { translate } from '../../../../i18n/TranslationService'
import { filterUserShapesByText } from '../AssigneeAndObserversModal/AssigneeAndObserversModal'

export default function WorkstreamMembersModal({
    closeModal,
    updateUsers,
    initialUserIds,
    projectIndex,
    headerText,
    subheaderText,
    projectId,
}) {
    const [width, height] = useWindowSize()
    const [selectedUsers, setSelectedUsers] = useState(new Map())
    const [filterText, setFilterText] = useState('')
    const users = useSelector(state => state.projectUsers[projectId])

    const usersFiltered = filterUserShapesByText(users, projectIndex, filterText)
    const sortedUsers = sortBy(usersFiltered, [item => item.displayName.toLowerCase()])
    const dispatch = useDispatch()

    const header = headerText || translate('Choose members')
    const subheader = subheaderText || translate('Select here the project members for this workstream')

    const tmpHeight = height - MODAL_MAX_HEIGHT_GAP
    const finalHeight = tmpHeight < 548 ? tmpHeight : 548

    const onSelectUser = contact => {
        let tmpObservers = new Map(selectedUsers)
        if (!tmpObservers.has(contact.uid)) {
            tmpObservers.set(contact.uid, contact)
        } else {
            tmpObservers.delete(contact.uid)
        }
        setSelectedUsers(tmpObservers)
    }

    const onDone = e => {
        e?.preventDefault()
        e?.stopPropagation()

        const observers = Array.from(selectedUsers.values())
        updateUsers?.(observers)
        return false
    }

    useEffect(() => {
        setSelectedUsers(
            new Map(
                initialUserIds ? initialUserIds.map(uid => [uid, TasksHelper.getUserInProject(projectId, uid)]) : []
            )
        )
    }, [])

    useEffect(() => {
        storeModal(WORKSTREAM_MEMBERS_MODAL_ID)
        dispatch(showFloatPopup())
        return () => {
            removeModal(WORKSTREAM_MEMBERS_MODAL_ID)
            dispatch(hideFloatPopup())
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: finalHeight }]}>
            <View style={localStyles.heading}>
                <Hotkeys keyName={'up,down,enter,esc'} onKeyDown={() => {}} filter={e => true}>
                    <View style={localStyles.title}>
                        <Text style={[styles.title7, { color: 'white' }]}>{header}</Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>{subheader}</Text>
                    </View>
                </Hotkeys>

                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeSubContainer} onPress={closeModal}>
                        <Icon name={'x'} size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>

                <SearchForm setText={setFilterText} />
            </View>

            <View style={localStyles.body}>
                {sortedUsers.length > 0 ? (
                    <ContactList
                        projectIndex={projectIndex}
                        userList={sortedUsers}
                        onSelectUser={onSelectUser}
                        selectedUsers={selectedUsers}
                    />
                ) : (
                    <EmptyResults />
                )}
            </View>

            <View style={localStyles.sectionSeparator} />

            <View style={localStyles.bottomSection}>
                <Button title={translate('Done save')} type={'primary'} onPress={onDone} shortcutText={'Enter'} />
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
        paddingBottom: 24,
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
