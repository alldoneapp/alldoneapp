import React from 'react'

import DataInput from './DataInput'

export default function CompanyCeo({ ceoRef, ceo, updateCeo }) {
    return (
        <DataInput
            inputRef={ceoRef}
            headerText={'CEO'}
            placeholder={'Type CEO'}
            value={ceo}
            setValue={updateCeo}
            externalContainerStyle={{ marginTop: 12 }}
        />
    )
}
