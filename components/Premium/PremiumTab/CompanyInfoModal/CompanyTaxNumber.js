import React from 'react'

import DataInput from './DataInput'

export default function CompanyTaxNumber({ taxNumberRef, taxNumber, updateTaxNumber }) {
    return (
        <DataInput
            inputRef={taxNumberRef}
            headerText={'Tax number'}
            placeholder={'Type tax number'}
            value={taxNumber}
            setValue={updateTaxNumber}
            externalContainerStyle={{ marginTop: 12 }}
        />
    )
}
