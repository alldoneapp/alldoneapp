import React from 'react'
import { TouchableOpacity } from 'react-native'
import Icon from '../../components/Icon'
// Assistant workspace and connection monitoring are unrelated to the statistics layout.
export default function Leaf({ inline, style }) {
    return inline ? (
        <TouchableOpacity style={[{ width: 28, height: 28 }, style]}>
            <Icon name="sidebar" size={24} color="#8A94A6" />
        </TouchableOpacity>
    ) : null
}
