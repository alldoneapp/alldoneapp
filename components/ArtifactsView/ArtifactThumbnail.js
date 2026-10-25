import React, { useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import Icon from '../Icon'
import { colors } from '../styles/global'
import { getArtifactKindIcon, getArtifactKindTint } from './artifactPresentation'

const DARK_TINT = { background: colors.Secondary300, icon: colors.Grey400 }

// A row's tile: the file itself where that is cheap to show (see getArtifactThumbnail), otherwise its
// kind icon on the kind's colour. A preview that cannot load (offline, a removed file, a type the
// browser cannot decode) falls back to the icon instead of a broken image.
export default function ArtifactThumbnail({ artifact, thumbnail, size = 44, onDark = false }) {
    const [failedUrl, setFailedUrl] = useState(null)
    const tint = onDark ? DARK_TINT : getArtifactKindTint(artifact.kind)
    const showPreview = Platform.OS === 'web' && !!thumbnail?.url && failedUrl !== thumbnail.url
    const fail = () => setFailedUrl(thumbnail?.url || null)

    return (
        <View
            testID={`artifact-thumbnail-${artifact.id}`}
            style={[
                localStyles.tile,
                { width: size, height: size, backgroundColor: showPreview ? colors.Grey200 : tint.background },
            ]}
        >
            {!showPreview ? (
                <Icon name={getArtifactKindIcon(artifact.kind)} size={size >= 40 ? 22 : 20} color={tint.icon} />
            ) : thumbnail.type === 'video' ? (
                <>
                    {/* `#t=` makes the browser paint a frame instead of a black box; metadata only, so
                        the list does not download the video. */}
                    <video
                        data-testid="artifact-thumbnail-video"
                        src={`${thumbnail.url}#t=0.1`}
                        preload="metadata"
                        muted
                        playsInline
                        onError={fail}
                        style={webStyles.media}
                    />
                    <View style={localStyles.playBadge}>
                        <Icon name="play" size={10} color="#FFFFFF" />
                    </View>
                </>
            ) : (
                <img
                    data-testid="artifact-thumbnail-image"
                    src={thumbnail.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    onError={fail}
                    style={webStyles.media}
                />
            )}
        </View>
    )
}

const webStyles = {
    media: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: 'block',
    },
}

const localStyles = StyleSheet.create({
    tile: {
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    playBadge: {
        position: 'absolute',
        right: 3,
        bottom: 3,
        width: 16,
        height: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        pointerEvents: 'none',
    },
})
