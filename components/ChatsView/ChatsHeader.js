import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../styles/global'
import ChatsMoreButton from '../UIComponents/FloatModals/MorePopupsOfMainViews/Chats/ChatsMoreButton'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'
import ChangeObjectListModal from '../UIComponents/FloatModals/ChangeObjectListModal'
import Shortcut from '../UIControls/Shortcut'
import { translate } from '../../i18n/TranslationService'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'

function ChatsHeader({ projectId, userId }) {
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

    return (
        <View style={localStyles.container}>
            <Hotkeys
                disabled={blockShortcuts || !showShortcuts || showFloatPopup !== 0 || !accessGranted}
                keyName={'s,alt+s'}
                onKeyDown={() => setOpen(true)}
                filter={e => true}
            />
            <View style={localStyles.info}>
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
                        <Text style={[styles.title5, { color: colors.Text01 }]}>{translate('Chats')}</Text>
                    </TouchableOpacity>
                </Popover>
                {showShortcuts && showFloatPopup === 0 && accessGranted && !mobile && (
                    <Shortcut text={'S'} containerStyle={localStyles.shortcut} />
                )}

                <ChatsMoreButton projectId={projectId} userId={userId} />
            </View>
        </View>
    )
}

export default ChatsHeader

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        maxHeight: 80,
        height: 80,
        minHeight: 80,
        paddingTop: 40,
        paddingBottom: 8,
    },
    info: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    shortcut: {
        marginLeft: 8,
    },
})
