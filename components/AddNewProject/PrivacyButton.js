import React, { useState } from 'react'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { View, Text, StyleSheet } from 'react-native'
import Icon from '../Icon'
import { colors } from '../styles/global'
import Popover from 'react-tiny-popover'
import ProjectPrivacyModal from '../ProjectDetailedView/ProjectProperties/PrivacyProperty/ProjectPrivacyModal'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../redux/store'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'

export default function PrivacyButton({ value, setPrivacy, disabled }) {
    const [isOpen, setIsOpen] = useState(false)

    const isMounted = React.useRef(true)

    React.useEffect(() => {
        return () => {
            isMounted.current = false
        }
    }, [])

    const hideModal = () => {
        setTimeout(() => {
            if (isMounted.current) {
                setIsOpen(false)
                store.dispatch(hideFloatPopup())
            }
        })
    }

    const showModal = () => {
        setIsOpen(true)
        store.dispatch(showFloatPopup())
    }

    return (
        <Popover
            isOpen={isOpen}
            onClickOutside={() => setIsOpen(false)}
            align={'center'}
            position={['right', 'bottom', 'top']}
            content={
                <ProjectPrivacyModal
                    setIsOpen={hideModal}
                    project={{ isShared: value }}
                    setSharedProperty={setPrivacy}
                />
            }
        >
            <TouchableOpacity
                style={localStyles.container}
                onPress={isOpen ? hideModal : showModal}
                disabled={disabled}
            >
                <View style={localStyles.button}>
                    <Icon name={ProjectHelper.getProjectPrivacyIcon(value)} size={20} color={colors.Grey100} />
                </View>
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 4,
        backgroundColor: colors.Secondary200,
    },
    button: {
        width: 40,
        height: 40,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
    },
})
