import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { calculateAutomaticCapacity, updateMilestoneDotColor } from '../GoalsView/GoalsHelper'

export default function ActiveMilestoneTagCapacityDot({ milestone, projectId, goals, externalStyle }) {
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const [automaticCapacity, setAutomaticCapacity] = useState(0)
    const [capacityButtonBackgroundColor, setCapacityButtonBackgroundColor] = useState('transparent')

    const { date: timestamp } = milestone

    useEffect(() => {
        const capacityButtonBackgroundColor = updateMilestoneDotColor(projectId, goals, milestone, automaticCapacity)
        setCapacityButtonBackgroundColor(capacityButtonBackgroundColor)
    }, [goals, automaticCapacity, milestone, usersInProject, projectId])

    useEffect(() => {
        setAutomaticCapacity(calculateAutomaticCapacity(timestamp))
        const intervale = setInterval(() => {
            setAutomaticCapacity(calculateAutomaticCapacity(timestamp))
        }, 60000)
        return () => {
            clearInterval(intervale)
        }
    }, [milestone])

    return <View style={[localStyles.dot, { backgroundColor: capacityButtonBackgroundColor }, externalStyle]} />
}

const localStyles = StyleSheet.create({
    dot: {
        height: 8,
        width: 8,
        borderRadius: 100,
        marginLeft: 16,
    },
})
