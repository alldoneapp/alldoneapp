import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { CONTACT_INFO_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { useSelector } from 'react-redux'
import ChangeContactInfoModal from '../../UIComponents/FloatModals/ChangeContactInfoModal'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function ContactInfoWrapper({ contact, projectId, setInfo, disabled = false }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const userRole = ProjectHelper.getUserRoleInProject(projectId, contact.uid, contact.role)
    const userCompany = ProjectHelper.getUserCompanyInProject(projectId, contact.uid, contact.company)
    const userDescription = ProjectHelper.getUserDescriptionInProject(
        projectId,
        contact.uid,
        contact.description,
        contact.extendedDescription,
        true
    )

    const openModal = () => {
        setIsOpen(true)
        storeModal(CONTACT_INFO_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        setTimeout(() => {
            removeModal(CONTACT_INFO_MODAL_ID)
        }, 400)
    }

    const changeInfo = info => {
        setInfo(info)
        closeModal()
    }

    return (
        <Popover
            content={
                <ChangeContactInfoModal
                    projectId={projectId}
                    closePopover={closeModal}
                    onSaveData={changeInfo}
                    currentRole={userRole ? userRole : ''}
                    currentCompany={userCompany ? userCompany : ''}
                    currentDescription={userDescription ? userDescription : ''}
                />
            }
            onClickOutside={closeModal}
            isOpen={isOpen}
            align={'start'}
            position={['bottom']}
            padding={4}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+1'}
                disabled={disabled}
                onKeyDown={(sht, event) => execShortcutFn(this.infoBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.infoBtnRef = ref)}
                    icon={'info'}
                    iconColor={colors.Text04}
                    buttonStyle={{
                        backgroundColor: 'transparent',
                        marginRight: 4,
                    }}
                    onPress={openModal}
                    disabled={disabled}
                    shortcutText={'1'}
                    forceShowShortcut={true}
                />
            </Hotkeys>
        </Popover>
    )
}
