import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { StyleSheet, Text, View } from 'react-native'

import AssistantTaskSearchButtonWrapper from '../../components/MyDayView/AssistantLine/AssistantOptions/Search/AssistantTaskSearchButtonWrapper'
import QuickActionsMeasurer from '../../components/MyDayView/AssistantLine/AssistantOptions/QuickActionsMeasurer'
import QuickActionsToggle from '../../components/MyDayView/AssistantLine/AssistantOptions/QuickActionsToggle'

const store = createStore((state = {}, action) => ({ ...state, lastAction: action.type }))

const measuredOptions = [
    { id: 'one', text: 'Prepare a detailed status report', icon: 'edit' },
    { id: 'two', text: 'Review every open project', icon: 'edit' },
    { id: 'three', text: 'Plan the next important actions', icon: 'edit' },
]

function Harness() {
    const [expanded, setExpanded] = React.useState(false)

    return (
        <Provider store={store}>
            <View style={styles.card}>
                <View style={[styles.row, expanded ? styles.expanded : styles.collapsed]}>
                    <AssistantTaskSearchButtonWrapper />
                    <QuickActionsToggle expanded={expanded} onPress={() => setExpanded(value => !value)} />
                    {expanded && <Text testID="overflow-action">Overflow action shown</Text>}
                    <QuickActionsMeasurer options={measuredOptions} onOptionLayout={() => {}} />
                </View>
            </View>
        </Provider>
    )
}

const styles = StyleSheet.create({
    card: {
        width: '100%',
        paddingHorizontal: 12,
        paddingTop: 40,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
    },
    collapsed: {
        height: 32,
        overflow: 'hidden',
    },
    expanded: {
        minHeight: 32,
        flexWrap: 'wrap',
    },
})

createRoot(document.getElementById('root')).render(<Harness />)
window.__ready = true
