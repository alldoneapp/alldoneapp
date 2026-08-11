import React from 'react'
import { View } from 'react-native'
import { colors } from './styles/global'

const Line = ({ width = 2 }) => <View style={{ width, height: 2, backgroundColor: colors.Text03 }}></View>
export default Line
