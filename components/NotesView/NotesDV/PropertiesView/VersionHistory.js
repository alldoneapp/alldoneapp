import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import GhostButton from '../../../UIControls/GhostButton'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import RevisionHistoryModal from '../../../UIComponents/FloatModals/RevisionHistoryModal/RevisionHistoryModal'
import { translate } from '../../../../i18n/TranslationService'

export default function VersionHistory({ projectId, note }) {
    const [open, setOpen] = useState(false)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const dispatch = useDispatch()

    const openModal = () => {
        setOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setOpen(false)
        dispatch(hideFloatPopup())
    }

    return (
        <View style={localStyles.container}>
            <View style={{ marginLeft: 'auto' }}>
                <Popover
                    content={<RevisionHistoryModal projectId={projectId} note={note} closeModal={closeModal} />}
                    onClickOutside={closeModal}
                    isOpen={open}
                    padding={4}
                    position={['top']}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    <GhostButton
                        title={translate('Recover a note version')}
                        type={'ghost'}
                        icon="icon-note-version-history"
                        onPress={openModal}
                    />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: { flex: 1, flexDirection: 'row', paddingLeft: 11, paddingVertical: 8, alignItems: 'center' },
})
