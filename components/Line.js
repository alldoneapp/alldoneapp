import React from 'react'
import { View } from 'react-native'
import { colors } from './styles/global'

const Line = ({ width }) => <View style={{ width, height: 2, backgroundColor: colors.Text03 }}></View>
Line.defaultProps = {
    width: 2,
}
export default Line
