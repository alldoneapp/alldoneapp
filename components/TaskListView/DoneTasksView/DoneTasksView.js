import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import DoneTasksByProject from './DoneTasksByProject'
import { setAmountTasksExpanded } from '../../../redux/actions'

import { themed } from '../../../Themes/colorMode'
import { CONTENT_MARGIN, CONTENT_MARGIN_TABLET } from '../../styles/global'

export default function DoneTasksView() {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])

    useEffect(() => {
        return () => {
            dispatch(setAmountTasksExpanded(0))
        }
    }, [])

    return (
        <View
            style={[
                localStyles.container,
                mobile ? localStyles.containerForMobile : isMiddleScreen && localStyles.containerForTablet,
            ]}
        >
            <DoneTasksByProject project={project} inSelectedProject={true} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: CONTENT_MARGIN,
        backgroundColor: themed.Surface,
    },
    containerForMobile: {
        paddingHorizontal: 16,
    },
    containerForTablet: {
        paddingHorizontal: CONTENT_MARGIN_TABLET,
    },
})
