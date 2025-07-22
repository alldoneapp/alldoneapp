import React from 'react'
import { View } from 'react-native'

import { dismissAllPopups } from '../../../utils/HelperFunctions'
import DismissibleItem from '../../UIComponents/DismissibleItem'
import AddAssistantPresentation from './AddAssistantPresentation'
import EditAssistant from './EditAssistant'

export default function AddAssistant({ projectId, setDismissibleRefs, openEdition, closeEdition }) {
    const refKey = 'addAssistant'

    const setRef = ref => {
        setDismissibleRefs(ref, refKey)
    }

    const openEditionMode = () => {
        openEdition(refKey)
        setTimeout(() => {
            dismissAllPopups()
        })
    }

    const closeEditionMode = () => {
        closeEdition(refKey)
    }

    return (
        <View>
            <DismissibleItem
                ref={setRef}
                defaultComponent={<AddAssistantPresentation onPress={openEditionMode} />}
                modalComponent={<EditAssistant projectId={projectId} adding={true} onCancelAction={closeEditionMode} />}
            />
        </View>
    )
}
