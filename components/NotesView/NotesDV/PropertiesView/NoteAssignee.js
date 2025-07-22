import React, { useEffect, useState } from 'react'
import { Image, StyleSheet } from 'react-native'
import { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import Popover from 'react-tiny-popover'
import NoteAssigneePicker from './NoteAssigneePicker'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { useSelector } from 'react-redux'
import { translate } from '../../../../i18n/TranslationService'
import { getUserData } from '../../../../utils/backends/Users/usersFirestore'
import { setNoteOwner } from '../../../../utils/backends/Notes/notesFirestore'

export default function NoteAssignee({ projectId, note, disabled }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const [owner, setOwner] = useState(null)
    const [visiblePopover, setVisiblePopover] = useState(false)

    const hidePopover = () => {
        setVisiblePopover(false)
    }

    const showPopover = () => {
        /* istanbul ignore next */
        setVisiblePopover(true)
    }

    useEffect(() => {
        getUserData(note.userId, false).then(user => setOwner(user))
    }, [note.userId])

    const onSelectUser = user => {
        setNoteOwner(projectId, note.id, user.uid, owner, user, note, true)
        setOwner(user)
        hidePopover()
    }

    return (
        owner && (
            <Popover
                content={
                    <NoteAssigneePicker
                        note={note}
                        onSelectUser={onSelectUser}
                        closePopover={hidePopover}
                        delayClosePopover={hidePopover}
                        projectId={projectId}
                    />
                }
                onClickOutside={hidePopover}
                isOpen={visiblePopover}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                contentLocation={smallScreen ? null : undefined}
            >
                <Button
                    type={'ghost'}
                    icon={<Image style={localStyles.userImage} source={{ uri: owner.photoURL }} />}
                    title={owner.displayName ? owner.displayName.trim().split(' ')[0] : `${translate('Loading')}...`}
                    onPress={showPopover}
                    disabled={disabled}
                />
            </Popover>
        )
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        height: 40,
        borderWidth: 1,
        borderColor: colors.Gray400,
        borderRadius: 4,
    },
    userImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
})
