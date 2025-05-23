import type { Address } from 'abitype'
import { fromHex, type Hex, type PrivateKeyAccount } from 'viem'
import { EIP712_SAFE_OPERATION_TYPE } from './safe'

import { setTimeout } from 'timers/promises'


export type UserOperation = {
    sender: Address
    nonce: bigint
    initCode: Hex
    callData: Hex
    callGasLimit: bigint
    verificationGasLimit: bigint
    preVerificationGas: bigint
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    paymasterAndData: Hex
    signature: Hex
  }
  
  // Sponsored User Operation Data
 
  export type gasData = {
    preVerificationGas: `0x${string}`
    callGasLimit: `0x${string}`
    verificationGasLimit: `0x${string}`
  }



export const getGasValuesFromGelato = async (
  entryPointAddress: `0x${string}`,
  sponsoredUserOperation: UserOperation,
  chainID: number,
  apiKey: string,
) => {
  const gasOptions = {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 0,
      jsonrpc: '2.0',
      method: 'eth_estimateUserOperationGas',
      params: [
        {
          sender: sponsoredUserOperation.sender,
          nonce: '0x' + sponsoredUserOperation.nonce.toString(16),
          initCode: sponsoredUserOperation.initCode,
          callData: sponsoredUserOperation.callData,
          signature: sponsoredUserOperation.signature,
          paymasterAndData: '0x',
        },
        entryPointAddress,
      ],
    }),
  }

  let responseValues: any
  await fetch(`https://api.gelato.digital//bundlers/${chainID}/rpc?sponsorApiKey=${apiKey}`, gasOptions)
    .then((response) => response.json())
    .then((response) => (responseValues = response))
    .catch((err) => console.error(err))
  console.log('\nReceived Gas Data from Gelato.')

  let rvGas
  if (responseValues && responseValues['result']) {
    rvGas = responseValues['result'] as gasData
  } else {
    console.log('Error or no result from Gelato:', responseValues?.error || responseValues)
  }

  return rvGas
}

export const submitUserOperationGelato = async (
  entryPointAddress: `0x${string}`,
  sponsoredUserOperation: UserOperation,
  chain: string,
  chainID: number,
  apiKey: string,
) => {


  const options = {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 0,
      jsonrpc: '2.0',
      method: 'eth_sendUserOperation',
      params: [
        {
          sender: sponsoredUserOperation.sender,
          nonce: '0x' + sponsoredUserOperation.nonce.toString(16),
          initCode: sponsoredUserOperation.initCode,
          callData: sponsoredUserOperation.callData,
          signature: sponsoredUserOperation.signature,
          paymasterAndData: sponsoredUserOperation.paymasterAndData,
          callGasLimit: '0x' + sponsoredUserOperation.callGasLimit.toString(16),
          verificationGasLimit: '0x' + sponsoredUserOperation.verificationGasLimit.toString(16),
          preVerificationGas: '0x' + sponsoredUserOperation.preVerificationGas.toString(16),
          maxFeePerGas: '0x' + sponsoredUserOperation.maxFeePerGas.toString(16),
          maxPriorityFeePerGas: '0x' + sponsoredUserOperation.maxPriorityFeePerGas.toString(16),
        },
        entryPointAddress,
      ],
    }),
  }

  let responseValues: any
  await fetch(`https://api.gelato.digital//bundlers/${chainID}/rpc?sponsorApiKey=${apiKey}`, options)
    .then((response) => response.json())
    .then((response) => (responseValues = response))
    .catch((err) => console.error(err))

  if (responseValues && responseValues['result']) {
    console.log('\nUserOperation submitted.\n\nGelato Relay Task ID:', responseValues['result'])
    console.log('Gelato Relay Task Link: https://api.gelato.digital/tasks/status/' + responseValues['result'])

    const hashOptions = {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 0,
        jsonrpc: '2.0',
        method: 'eth_getUserOperationReceipt',
        params: [responseValues['result']],
      }),
    }

    let runOnce = true

    while (responseValues['result'] == null || runOnce) {
      await setTimeout(25000)
      await fetch(`https://api.gelato.digital//bundlers/${chainID}/rpc?sponsorApiKey=${apiKey}`, hashOptions)
        .then((response) => response.json())
        .then((response) => (responseValues = response))
        .catch((err) => console.error(err))
      runOnce = false
    }

    if (responseValues['result'] && responseValues['result']['receipt']['transactionHash']) {
      const rvEntryPoint = responseValues['result']['logs'][responseValues['result']['logs'].length - 2]['address']

      if (rvEntryPoint == entryPointAddress) {
        const userOpHash = responseValues['result']['logs'][responseValues['result']['logs'].length - 2]['topics'][1]
        console.log('\nUser OP Hash: ' + userOpHash + '\nUserOp Link: https://jiffyscan.xyz/userOpHash/' + userOpHash + '?network=' + chain)
      }
      console.log('\nTransaction Link: https://' + chain + '.etherscan.io/tx/' + responseValues['result']['receipt']['transactionHash'])
      const actualGasUsed = fromHex(responseValues['result']['actualGasUsed'], 'number')
      const gasUsed = fromHex(responseValues['result']['receipt']['gasUsed'], 'number')
      console.log(`\nGas Used (Account or Paymaster): ${actualGasUsed}`)
      console.log(`Gas Used (Transaction): ${gasUsed}\n`)
    } else {
      console.log('\n' + responseValues['error'])
    }
  } else {
    if (responseValues && responseValues['message']) {
      console.log('\n' + responseValues['message'])
    }
  }
}

export const signUserOperation = async (
  userOperation: UserOperation,
  signer: PrivateKeyAccount,
  chainID: any,
  entryPointAddress: any,
  safe4337ModuleAddress: any,
) => {
  const signatures = [
    {
      signer: signer.address,
      data: await signer.signTypedData({
        domain: {
          chainId: chainID,
          verifyingContract: safe4337ModuleAddress,
        },
        types: EIP712_SAFE_OPERATION_TYPE,
        primaryType: 'SafeOp',
        message: {
          safe: userOperation.sender,
          nonce: userOperation.nonce,
          initCode: userOperation.initCode,
          callData: userOperation.callData,
          callGasLimit: userOperation.callGasLimit,
          verificationGasLimit: userOperation.verificationGasLimit,
          preVerificationGas: userOperation.preVerificationGas,
          maxFeePerGas: userOperation.maxFeePerGas,
          maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas,
          paymasterAndData: userOperation.paymasterAndData,
          validAfter: '0x000000000000',
          validUntil: '0x000000000000',
          entryPoint: entryPointAddress,
        },
      }),
    },
  ]

  signatures.sort((left, right) => left.signer.toLowerCase().localeCompare(right.signer.toLowerCase()))

  let signatureBytes: Address = '0x000000000000000000000000'
  for (const sig of signatures) {
    signatureBytes += sig.data.slice(2)
  }

  return signatureBytes
}
