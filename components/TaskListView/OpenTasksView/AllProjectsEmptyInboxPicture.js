import React from 'react'

import ModernImage from '../../../utils/ModernImage'

export default function AllProjectsEmptyInboxPicture() {
    const randomImage = React.useMemo(() => {
        const images = [
            {
                srcWebp: require('../../../assets/anna_allprojects_done_01.webp'),
                fallback: require('../../../assets/anna_allprojects_done_01.png'),
            },
            {
                srcWebp: require('../../../assets/anna_allprojects_done_02.webp'),
                fallback: require('../../../assets/anna_allprojects_done_02.png'),
            },
            {
                srcWebp: require('../../../assets/anna_allprojects_done_03.webp'),
                fallback: require('../../../assets/anna_allprojects_done_03.png'),
            },
            {
                srcWebp: require('../../../assets/anna_allprojects_done_04.webp'),
                fallback: require('../../../assets/anna_allprojects_done_04.png'),
            },
        ]
        const randomIndex = Math.floor(Math.random() * images.length)
        return images[randomIndex]
    }, [])

    return (
        <ModernImage
            srcWebp={randomImage.srcWebp}
            fallback={randomImage.fallback}
            style={{ flex: 1, width: '100%', maxWidth: 460, borderRadius: 16 }}
            alt={'All projects done'}
        />
    )
}
