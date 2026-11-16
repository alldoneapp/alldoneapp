import React, { useContext, useState } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'
import AnnaChatNavigationContext, {
    AnnaSidebarCloseContext,
    AnnaSidebarProjectContext,
} from './AnnaChatNavigationContext'
import AssistantModeIcon from '../UIComponents/AssistantModeIcon'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

import { adaptiveColor } from '../../Themes/colorMode'

/**
 * The assistant-mode panel button. AT-3034: it sits at the top left of the assistant line's header
 * (it used to lead the app's top bar). Pressing it opens assistant mode with the line's project
 * selected in the sidebar chat, so the assistant answering there is the one the line showed
 * (`projectId`: the line's project, or null for the "All projects" line = "Automatic"). Omitting
 * `projectId` opens the sidebar on whatever project it already has.
 *
 * While the desktop sidebar already shows that project's chat the button closes it instead, as the
 * header button did. If the sidebar is on another project, the press moves it here.
 */
export default function AssistantModeButton({
    onOpen,
    inline = false,
    style,
    projectId,
    assistantName,
    testID = 'top-bar-assistant-mode',
}) {
    const assistant = useSelector(state => state.defaultAssistant)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const showChat = useContext(AnnaChatNavigationContext)
    const closeSidebar = useContext(AnnaSidebarCloseContext)
    const sidebarProjectId = useContext(AnnaSidebarProjectContext)
    const [hovered, setHovered] = useState(false)

    if (isAnonymous || !assistant?.uid) return null

    const targetsProject = projectId !== undefined
    const showsTarget = !targetsProject || (projectId || defaultProjectId || null) === (sidebarProjectId || null)
    const expanded = !!closeSidebar && showsTarget
    const highlighted = expanded || hovered
    const name = assistantName?.trim() || assistant.displayName?.trim() || translate('Assistant')
    const label = `${name}: ${translate(expanded ? 'Close assistant chat' : 'Open assistant chat')}`
    return (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={label}
            aria-pressed={expanded}
            testID={testID}
            style={[localStyles.button, hovered && localStyles.hovered, !inline && localStyles.centered, style]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onPress={event => {
                // The assistant line's header sits inside touchables of its own.
                event?.stopPropagation?.()
                onOpen?.()
                if (expanded) closeSidebar()
                else if (targetsProject) showChat({ projectId: projectId || null })
                else showChat()
            }}
        >
            <AssistantModeIcon
                expanded={expanded}
                color={highlighted ? colors.Primary100 : colors.Text03}
                title={label}
            />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        // Match Search's 28px control and 24px icon footprint.
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
    },
    hovered: {
        backgroundColor: adaptiveColor('#E2EFFF'),
    },
    centered: {
        position: 'absolute',
        left: '50%',
        marginLeft: -14,
        top: 14,
    },
})
