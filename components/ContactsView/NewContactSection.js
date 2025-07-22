import React from 'react'
import { useSelector } from 'react-redux'

import DismissibleItem from '../UIComponents/DismissibleItem'
import AddContact from './AddContact'
import EditContact from './EditContact'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import { isSomeContactEditOpen } from './Utils/ContactsHelper'

export default function NewContactSection({ projectIndex, newItemRef, dismissibleRefs }) {
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)

    const onOpenInput = () => {
        if (isSomeContactEditOpen()) {
            dismissAllPopups()
        } else {
            newItemRef.current?.toggleModal()
            for (let key in dismissibleRefs) {
                dismissibleRefs[key].closeModal()
            }
        }
    }

    const onCloseInput = () => {
        newItemRef.current?.toggleModal()
    }

    return (
        <DismissibleItem
            ref={ref => {
                if (ref) newItemRef.current = ref
            }}
            defaultComponent={<AddContact onPress={onOpenInput} />}
            modalComponent={
                <EditContact
                    projectId={loggedUserProjects[projectIndex].id}
                    onCancelAction={onCloseInput}
                    isNew={true}
                />
            }
        />
    )
}
