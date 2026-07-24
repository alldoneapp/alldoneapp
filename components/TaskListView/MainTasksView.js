import React, { useEffect } from 'react'
import { KeyboardAvoidingView } from 'react-native'
import { useDispatch } from 'react-redux'

import { setNavigationRoute, setSelectedSidebarTab } from '../../redux/actions'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'
import TasksAmountContainers from './TasksAmountContainers/TasksAmountContainers'
import WriteTasksUrl from './WriteTasksUrl'
import TasksSections from './TasksSections'

export default function MainTasksView() {
    const dispatch = useDispatch()

    useEffect(() => {
        dispatch([setSelectedSidebarTab(DV_TAB_ROOT_TASKS), setNavigationRoute(DV_TAB_ROOT_TASKS)])
    }, [])

    return (
        <KeyboardAvoidingView behavior="padding" style={localStyles.container}>
            <WriteTasksUrl />
            <TasksAmountContainers />
            <HashtagFiltersView handleSpaces={true} />
            <TasksSections />
        </KeyboardAvoidingView>
    )
}

const localStyles = {
    container: {
        flex: 1,
        backgroundColor: 'white',
    },
}
