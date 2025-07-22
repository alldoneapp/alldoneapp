import React from 'react'

import DataInput from './DataInput'

export default function CompanyBankAddress({ bankAddressRef, bankAddress, updateBankAddress }) {
    return (
        <DataInput
            inputRef={bankAddressRef}
            headerText={'Bank address'}
            placeholder={'Type bank address'}
            value={bankAddress}
            setValue={updateBankAddress}
            externalContainerStyle={{ marginTop: 12 }}
        />
    )
}
