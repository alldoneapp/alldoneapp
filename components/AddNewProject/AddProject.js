import React, { useRef, useEffect } from 'react'
import { Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../Icon'
import styles from '../styles/global'
import DismissibleItem from '../UIComponents/DismissibleItem'
import AddProjectForm from './AddProjectForm'
import { getTheme } from '../../Themes/Themes'
import { Themes } from '../SidebarMenu/Themes'
import { translate } from '../../i18n/TranslationService'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'
import { setAddProjectStatus } from '../../redux/actions'
import useOnHover from '../../hooks/UseOnHover'
import { checkIsLimitedByXp } from '../Premium/PremiumHelper'

export default function AddProject({ scrollToBottom, addingTemplate }) {
    const dispatch = useDispatch()
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const sidebarInputOpenType = useSelector(state => state.sidebarInputOpenType)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const dismissibleRef = useRef()
    const { expanded } = useCollapsibleSidebar()
    const { hover, onHover, offHover } = useOnHover()

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.AddProject')

    useEffect(() => {
        if (showGlobalSearchPopup && dismissibleRef.current.modalIsVisible()) {
            dismissibleRef.current.toggleModal()
        }
    }, [showGlobalSearchPopup])

    useEffect(() => {
        if (addingTemplate && sidebarInputOpenType === 'normal') {
            dismissibleRef.current.closeModal()
        } else if (!addingTemplate && sidebarInputOpenType === 'template') {
            dismissibleRef.current.closeModal()
        }
    }, [sidebarInputOpenType])

    const openModal = () => {
        if (!checkIsLimitedByXp(null)) {
            dismissibleRef.current.openModal()
            if (!sidebarExpanded && !smallScreenNavigation) dispatch(setAddProjectStatus(true))
        }
    }

    const closeModal = () => {
        dismissibleRef.current?.closeModal()
        dispatch(setAddProjectStatus(false))
    }

    return (
        <DismissibleItem
            ref={dismissibleRef}
            defaultComponent={
                <TouchableOpacity
                    style={[
                        localStyles.placeholder,
                        !expanded && localStyles.placeholderCollapsed,
                        hover && theme.containerHover,
                    ]}
                    onPress={openModal}
                    onMouseEnter={onHover}
                    onMouseLeave={offHover}
                >
                    <Icon
                        size={22}
                        name={'plus-square'}
                        color={theme.placeholderText.color}
                        style={theme.placeholderText}
                    />
                    {expanded && (
                        <Text style={[localStyles.placeholderText, theme.placeholderText]} numberOfLines={1}>
                            {translate(addingTemplate ? 'Add new template' : 'Add new project')}
                        </Text>
                    )}
                </TouchableOpacity>
            }
            modalComponent={
                <AddProjectForm
                    closeForm={() => closeModal()}
                    scrollToBottom={scrollToBottom}
                    addingTemplate={addingTemplate}
                />
            }
        />
    )
}

const localStyles = StyleSheet.create({
    placeholder: {
        flexDirection: 'row',
        height: 56,
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    placeholderCollapsed: {
        paddingLeft: 17,
    },
    placeholderText: {
        ...styles.body1,
        paddingLeft: 8,
        flexWrap: 'nowrap',
    },
})
