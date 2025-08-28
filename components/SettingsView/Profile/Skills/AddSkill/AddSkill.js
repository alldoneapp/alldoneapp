import React from 'react'
import { View } from 'react-native'

import { dismissAllPopups } from '../../../../../utils/HelperFunctions'
import DismissibleItem from '../../../../UIComponents/DismissibleItem'
import AddSkillPresentation from './AddSkillPresentation'
import EditSkill from '../SkillItem/EditSkill'

export default function AddSkill({ projectId, setDismissibleRefs, openEdition, closeEdition }) {
    const refKey = projectId

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
                defaultComponent={<AddSkillPresentation onPress={openEditionMode} />}
                modalComponent={<EditSkill projectId={projectId} adding={true} onCancelAction={closeEditionMode} />}
            />
        </View>
    )
}
