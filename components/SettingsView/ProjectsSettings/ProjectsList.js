import React from 'react'
import { View } from 'react-native'

import ProjectItem from './ProjectItem'

export default function ProjectsList({ projects }) {
    return (
        <View style={{ flex: 1 }}>
            {projects.map((project, i) => (
                <ProjectItem key={i} project={project} />
            ))}
        </View>
    )
}
