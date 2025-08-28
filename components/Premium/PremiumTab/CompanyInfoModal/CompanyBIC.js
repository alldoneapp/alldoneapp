import React from 'react'

import DataInput from './DataInput'

export default function CompanyBIC({ bicRef, bic, updateBic }) {
    return (
        <DataInput
            inputRef={bicRef}
            headerText={'BIC'}
            placeholder={'Type BIC'}
            value={bic}
            setValue={updateBic}
            externalContainerStyle={{ marginTop: 12 }}
        />
    )
}
