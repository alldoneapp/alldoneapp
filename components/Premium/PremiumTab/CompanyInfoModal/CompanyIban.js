import React from 'react'

import DataInput from './DataInput'

export default function CompanyIban({ ibanRef, iban, updateIban }) {
    return (
        <DataInput
            inputRef={ibanRef}
            headerText={'IBAN'}
            placeholder={'Type IBAN'}
            value={iban}
            setValue={updateIban}
            externalContainerStyle={{ marginTop: 12 }}
        />
    )
}
