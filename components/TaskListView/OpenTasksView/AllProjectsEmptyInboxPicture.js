import React from 'react'

import MyPlatform from '../../MyPlatform'
import ModernImage from '../../../utils/ModernImage'

export default function AllProjectsEmptyInboxPicture() {
    const isSafari = MyPlatform.browserType === 'safari'

    return (
        <>
            {isSafari ? (
                <ModernImage
                    srcWebp={require('../../../web/images/illustrations/Empty-Inbox-All_Projects.webp')}
                    fallback={require('../../../web/images/illustrations/Empty-Inbox-All_Projects.png')}
                    style={{ flex: 1, width: '100%', maxWidth: 460 }}
                    alt={'Empty Goals inbox All projects'}
                />
            ) : (
                <video loop muted autoPlay playsInline style={{ flex: 1, width: '100%', maxWidth: 354 }}>
                    <source
                        src={require('../../../web/images/illustrations/Empty-Inbox-All_Projects.webm')}
                        type="video/webm"
                        color={'transparent'}
                    />
                </video>
            )}
        </>
    )
}
