import React from 'react'
import ColoredCircle from './ColoredCircle'

export default function ProjectItemIcon({ projectId, projectColor, highlight, isGuide }) {
    return <ColoredCircle projectId={projectId} projectColor={projectColor} highlight={highlight} isGuide={isGuide} />
}
