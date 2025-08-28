import React from 'react'

import FeatureDescription from '../../PremiumTab/FeatureDescription'

export default function PremiumFeatures() {
    return (
        <>
            <FeatureDescription text={'Unlimited tasks per month'} />
            <FeatureDescription text={'1 GB traffic per month (normal use means you wont notice it)'} />
            <FeatureDescription text={'Full access to search'} />
            <FeatureDescription text={`A monthly bonus`} />
        </>
    )
}
