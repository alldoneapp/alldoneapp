import React from 'react'

export default function ModernImage({ srcWebp, srcJrx, srcJp2, fallback, alt, ...props }) {
    return (
        <picture>
            <source srcSet={srcWebp} type="image/webp" />
            <source srcSet={srcJrx} type="image/jxr" />
            <source srcSet={srcJp2} type="image/jp2" />
            <source srcSet={fallback} type="image/jpeg" />
            <img src={fallback} alt={alt} {...props} />
        </picture>
    )
}
