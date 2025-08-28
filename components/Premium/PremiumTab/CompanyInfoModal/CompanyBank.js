import React from 'react'

import DataInput from './DataInput'

export default function CompanyBank({ bankRef, bank, updateBank }) {
    return (
        <DataInput
            inputRef={bankRef}
            headerText={'Bank'}
            placeholder={'Type bank'}
            value={bank}
            setValue={updateBank}
            externalContainerStyle={{ marginTop: 12 }}
        />
    )
}
