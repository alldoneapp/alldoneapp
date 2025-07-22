import React from 'react'

import DataInput from './DataInput'

export default function CompanyVatId({ vatIdRef, vatId, updateVatId }) {
    return (
        <DataInput
            inputRef={vatIdRef}
            headerText={'VAT ID'}
            placeholder={'Type VAT ID'}
            value={vatId}
            setValue={updateVatId}
            externalContainerStyle={{ marginTop: 12 }}
        />
    )
}
