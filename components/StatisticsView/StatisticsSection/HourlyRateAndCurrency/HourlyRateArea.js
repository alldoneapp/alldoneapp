import React from 'react'
import { useSelector } from 'react-redux'

import CustomScrollView from '../../../UIControls/CustomScrollView'
import RateUserItem from './RateUserItem'

export default function HourlyRateArea({ projectId, hourlyPerUser, setHourlyPerUser }) {
    const usersInProjects = useSelector(state => state.projectUsers[projectId])

    return (
        <CustomScrollView containerStyle={{ marginTop: 8 }} indicatorStyle={{ marginRight: -16 }}>
            {usersInProjects.map(user => (
                <RateUserItem
                    key={user.uid}
                    user={user}
                    hourlyRate={hourlyPerUser[user.uid]}
                    setHourlyPerUser={setHourlyPerUser}
                />
            ))}
        </CustomScrollView>
    )
}
