import React, { useState } from 'react'
import { StyleSheet, View, TouchableOpacity, Text } from 'react-native'
import { colors, em2px } from '../styles/global'
import Popover from 'react-tiny-popover'
import ColorPickerModal from '../UIComponents/FloatModals/ColorPickerModal'
import store from '../../redux/store'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { useSelector } from 'react-redux'
import { getTheme } from '../../Themes/Themes'
import { Themes } from '../SidebarMenu/Themes'
import { PROJECT_COLOR_BLUE } from '../../Themes/Modern/ProjectColors'

export default function ColorButton({ value = PROJECT_COLOR_BLUE, setColor, style, scrollToBottom, disabled }) {
    let [modalOpen, setModalOpen] = useState(false)
    const loggedUser = useSelector(state => state.loggedUser)
    const theme = getTheme(Themes, loggedUser.themeName, 'CustomSideMenu.AddProject.AddProjectForm.ColorButton')

    const hideModal = () => {
        setTimeout(() => {
            setModalOpen(false)
            store.dispatch(hideFloatPopup())
        })
    }

    const showModal = () => {
        setModalOpen(true)
        scrollToBottom?.()
        store.dispatch(showFloatPopup())
    }

    const changeColor = color => {
        setColor(color)
        hideModal()
    }

    return (
        <Popover
            content={
                <ColorPickerModal color={value} selectColor={changeColor} closePopover={hideModal} inSidebar={true} />
            }
            onClickOutside={hideModal}
            isOpen={modalOpen}
            position={['bottom', 'top', 'left', 'right']}
            padding={4}
            align={'end'}
        >
            <TouchableOpacity
                style={[localStyles.container, theme.container, style]}
                onPress={showModal}
                accessible={false}
                disabled={disabled}
            >
                <View style={[localStyles.projectColorBall, { backgroundColor: value }]} />
                <Text style={[localStyles.text, theme.text]}>Color</Text>
            </TouchableOpacity>
        </Popover>
    )
}
const localStyles = StyleSheet.create({
    container: {
        height: 40,
        paddingLeft: 12,
        paddingRight: 16,
        borderRadius: 4,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    projectColorBall: {
        borderRadius: 100,
        width: 16,
        height: 16,
    },
    text: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 14,
        alignItems: 'center',
        letterSpacing: em2px(0.05),
        marginLeft: 12,
    },
})
