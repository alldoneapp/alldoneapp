import React, { useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import styles, { colors } from '../../styles/global'
import CustomScrollView from '../../UIControls/CustomScrollView'
import ContactItem from '../../UIComponents/FloatModals/AssigneeAndObserversModal/List/ContactItem'
import Button from '../../UIControls/Button'
import CloseButton from '../../FollowUp/CloseButton'
import { useSelector } from 'react-redux'
import useWindowSize from '../../../utils/useWindowSize'
import { translate } from '../../../i18n/TranslationService'
import { updateStatisticsSelectedUsersIds } from '../../../utils/backends/Users/usersFirestore'

const FilterStatisticsModal = ({ projectIndex, filterByUsers, setIsOpen, projectId }) => {
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const itemsComponentsRefs = useRef({})
    const scrollRef = useRef()
    const [width, height] = useWindowSize()
    const tmpHeight = height - MODAL_MAX_HEIGHT_GAP
    const finalHeight = tmpHeight < 400 ? tmpHeight : 400
    const [usersSelected, setUsersSelected] = useState(filterByUsers)

    const selectUser = user => {
        if (!usersSelected.includes(user.uid)) {
            setUsersSelected([...usersSelected.filter(item => item !== user.uid), user.uid])
        } else {
            setUsersSelected(usersSelected.filter(item => item !== user.uid))
        }
    }

    const saveData = () => {
        updateStatisticsSelectedUsersIds(projectId, usersSelected)
        setIsOpen(false)
    }

    return (
        <View style={[localStyles.box, applyPopoverWidth(), { maxHeight: finalHeight }]}>
            <View style={{ marginBottom: 20 }}>
                <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Filter by users')}</Text>
                <Text style={[styles.body2, { color: colors.Text03 }]}>
                    {translate('Allows you to select the users you want to see the statistics')}
                </Text>
            </View>
            <CustomScrollView ref={scrollRef} indicatorStyle={{ right: -10 }}>
                {usersInProject.map((contact, index) => {
                    return (
                        <ContactItem
                            key={index}
                            projectIndex={projectIndex}
                            contact={contact}
                            onSelectContact={selectUser}
                            isActive={usersSelected.includes(contact.uid)}
                            isHovered={usersSelected.includes(contact.uid)}
                            itemsComponentsRefs={itemsComponentsRefs}
                        />
                    )
                })}
            </CustomScrollView>
            <Button title={'Save'} buttonStyle={{ marginTop: 8, alignSelf: 'center' }} onPress={saveData} />
            <CloseButton close={() => setIsOpen(false)} style={localStyles.closeButton} />
        </View>
    )
}

export default FilterStatisticsModal

const localStyles = StyleSheet.create({
    box: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        borderRadius: 4,
        width: 432,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    closeButton: {
        top: 8,
        right: 8,
    },
})
