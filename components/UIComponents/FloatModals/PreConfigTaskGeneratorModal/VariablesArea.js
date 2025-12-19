import React from 'react'
import { View } from 'react-native'

import VariableItem from './VariableItem'
import Line from '../GoalMilestoneModal/Line'

export default function VariablesArea({ variables, inputRefs, setValue, values, projectId, setMentionsModalActive }) {
    const setInputRefs = (ref, name) => {
        if (ref) inputRefs.current[name] = ref
    }

    return (
        <View>
            <Line style={{ marginTop: -4, marginBottom: 16 }} />
            {variables.map(variable => {
                const { name } = variable
                return (
                    <VariableItem
                        setInputRefs={setInputRefs}
                        key={name}
                        name={name}
                        setValue={setValue}
                        value={values[name]}
                        projectId={projectId}
                        setMentionsModalActive={setMentionsModalActive}
                    />
                )
            })}
        </View>
    )
}
