import React from 'react'

import MyPlatform from '../../MyPlatform'
import ModernImage from '../../../utils/ModernImage'

export default function AllProjectsEmptyInboxPicture() {
    const randomImage = React.useMemo(() => {
        const images = [
            require('../../../assets/anna_allprojects_done_01.png'),
            require('../../../assets/anna_allprojects_done_02.png'),
            require('../../../assets/anna_allprojects_done_03.png'),
            require('../../../assets/anna_allprojects_done_04.png'),
        ]
        const randomIndex = Math.floor(Math.random() * images.length)
        return images[randomIndex]
    }, [])

    return (
        <ModernImage
            srcWebp={randomImage}
            fallback={randomImage}
            style={{ flex: 1, width: '100%', maxWidth: 460, borderRadius: 16 }}
            alt={'All projects done'}
        />
    )
}
