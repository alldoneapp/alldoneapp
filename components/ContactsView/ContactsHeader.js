import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../styles/global'
import ContactMoreButton from '../UIComponents/FloatModals/MorePopupsOfMainViews/Contacts/ContactMoreButton'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'
import ChangeObjectListModal from '../UIComponents/FloatModals/ChangeObjectListModal'
import Shortcut from '../UIControls/Shortcut'
import { translate } from '../../i18n/TranslationService'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'

const ContactsHeader = ({ contactAmount, projectId, selectedUser }) => {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const realProjectIds = useSelector(state => state.loggedUser.realProjectIds)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const showShortcuts = useSelector(state => state.showShortcuts)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const [open, setOpen] = useState(false)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const accessGranted = !isAnonymous && (inAllProjects || (project && realProjectIds.includes(project.id)))

    const parseText = number => {
        return translate(number > 1 ? 'Amount members' : 'Amount member', { amount: number })
    }

    return (
        <View style={localStyles.container}>
            <Hotkeys
                disabled={blockShortcuts || !showShortcuts || showFloatPopup !== 0 || !accessGranted}
                keyName={'s,alt+s'}
                onKeyDown={() => setOpen(true)}
                filter={e => true}
            />
            <Popover
                content={<ChangeObjectListModal closePopover={() => setOpen(false)} />}
                onClickOutside={() => setOpen(false)}
                isOpen={open}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'start'}
                contentLocation={mobile ? null : undefined}
            >
                <TouchableOpacity disabled={!accessGranted} accessible={false} onPress={() => setOpen(true)}>
                    <Text style={styles.title5}>{translate('Contacts')}</Text>
                </TouchableOpacity>
            </Popover>
            {showShortcuts && showFloatPopup === 0 && accessGranted && !mobile && (
                <Shortcut text={'S'} containerStyle={localStyles.shortcut} />
            )}

            <ContactMoreButton projectId={projectId} user={selectedUser} />
            <View style={localStyles.amountContainer}>
                <Text style={[styles.caption2, { color: colors.Text02 }]}>{parseText(contactAmount)}</Text>
            </View>
        </View>
    )
}

export default ContactsHeader

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
    amountContainer: {
        height: 28,
        justifyContent: 'flex-end',
    },
    shortcut: {
        marginLeft: 8,
    },
})
