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
  paymasterVerificationGasLimit?: `0x${string}` // v0.7 addition
  paymasterPostOpGasLimit?: `0x${string}` // v0.7 addition
}

// Helper function to detect EntryPoint version
export const detectEntryPointVersion = (entryPointAddress: string): 'v0.6' | 'v0.7' => {
  const v06Address = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'
  const v07Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'
  
  if (entryPointAddress.toLowerCase() === v06Address.toLowerCase()) {
    return 'v0.6'
  } else if (entryPointAddress.toLowerCase() === v07Address.toLowerCase()) {
    return 'v0.7'
  }
  
  // Default to v0.6 if unknown
  console.warn(`Unknown EntryPoint address: ${entryPointAddress}, defaulting to v0.6`)
  return 'v0.6'
}

// Helper function to parse initCode for v0.7
const parseInitCode = (initCode: Hex) => {
  if (!initCode || initCode === '0x' || initCode.length < 42) {
    return { factory: undefined, factoryData: undefined }
  }
  
  const factory = initCode.slice(0, 42) // First 20 bytes (0x + 40 chars)
  const factoryData = '0x' + initCode.slice(42) // Rest of the data
  
  return { factory, factoryData }
}

// Helper function to parse paymasterAndData for v0.7
const parsePaymasterAndData = (paymasterAndData: Hex) => {
  if (!paymasterAndData || paymasterAndData === '0x' || paymasterAndData.length < 42) {
    return {
      paymaster: undefined,
      paymasterVerificationGasLimit: undefined,
      paymasterPostOpGasLimit: undefined,
      paymasterData: undefined
    }
  }
  
  // For sponsored transactions with Gelato, the format might be different
  // This is a basic parsing - adjust based on your paymaster format
  const paymaster = paymasterAndData.slice(0, 42)
  let paymasterVerificationGasLimit: string | undefined
  let paymasterPostOpGasLimit: string | undefined
  let paymasterData: string | undefined
  
  if (paymasterAndData.length > 42) {
    // Parse gas limits and data if present
    // Format: paymaster (20 bytes) + verificationGasLimit (32 bytes) + postOpGasLimit (32 bytes) + data
    if (paymasterAndData.length >= 42 + 64 + 64) {
      paymasterVerificationGasLimit = '0x' + paymasterAndData.slice(42, 42 + 64)
      paymasterPostOpGasLimit = '0x' + paymasterAndData.slice(42 + 64, 42 + 64 + 64)
      paymasterData = '0x' + paymasterAndData.slice(42 + 64 + 64)
    } else {
      paymasterData = '0x' + paymasterAndData.slice(42)
    }
  }
  
  return {
    paymaster,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    paymasterData
  }
}

export const getGasValuesFromGelato = async (
  entryPointAddress: `0x${string}`,
  sponsoredUserOperation: UserOperation,
  chainID: number,
  apiKey: string,
) => {
  const version = detectEntryPointVersion(entryPointAddress)
  console.log(`\nDetected EntryPoint version: ${version}`)
  
  let userOpForEstimation: any

  if (version === 'v0.7') {
    // v0.7 format
    const { factory, factoryData } = parseInitCode(sponsoredUserOperation.initCode)
    const paymasterInfo = parsePaymasterAndData(sponsoredUserOperation.paymasterAndData)

    userOpForEstimation = {
      sender: sponsoredUserOperation.sender,
      nonce: '0x' + sponsoredUserOperation.nonce.toString(16),
      factory: factory || '0x',
      factoryData: factoryData || '0x',
      callData: sponsoredUserOperation.callData,
      callGasLimit: '0x0', // Let bundler estimate
      verificationGasLimit: '0x0', // Let bundler estimate
      preVerificationGas: '0x0', // Set to 0x0 for estimation
      maxFeePerGas: '0x0', // Set to 0x0 for estimation
      maxPriorityFeePerGas: '0x0', // Set to 0x0 for estimation
      signature: sponsoredUserOperation.signature,
      // v0.7 specific fields
      paymaster: '0x',
      paymasterVerificationGasLimit: '0x0',
      paymasterPostOpGasLimit: '0x0',
      paymasterData: paymasterInfo.paymasterData || '0x',
    }
  } else {
    // v0.6 format (your original code)
    userOpForEstimation = {
      sender: sponsoredUserOperation.sender,
      nonce: '0x' + sponsoredUserOperation.nonce.toString(16),
      initCode: sponsoredUserOperation.initCode,
      callData: sponsoredUserOperation.callData,
      signature: sponsoredUserOperation.signature,
      paymasterAndData: '0x',
    }
  }

  const gasOptions = {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 0,
      jsonrpc: '2.0',
      method: 'eth_estimateUserOperationGas',
      params: [userOpForEstimation, entryPointAddress],
    }),
  }

  console.log('\nSending gas estimation request:', JSON.stringify(userOpForEstimation, null, 2))

  let responseValues: any
  await fetch(`https://api.gelato.digital//bundlers/${chainID}/rpc?sponsorApiKey=${apiKey}`, gasOptions)
    .then((response) => response.json())
    .then((response) => (responseValues = response))
    .catch((err) => console.error(err))
  
  console.log('\nReceived Gas Data from Gelato.')

  let rvGas
  if (responseValues && responseValues['result']) {
    rvGas = responseValues['result'] as gasData
    console.log('Gas estimation successful:', rvGas)
  } else {
    console.log('Error or no result from Gelato:', responseValues?.error || responseValues)
    
    // Fallback gas values for v0.7 if estimation fails
    if (version === 'v0.7') {
      console.log('Using fallback gas values for v0.7')
      rvGas = {
        preVerificationGas: '0xc350', // 50,000
        verificationGasLimit: '0x76c0', // 30,400
        callGasLimit: '0x55730', // 350,000
      }
    }
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
  const version = detectEntryPointVersion(entryPointAddress)
  let userOpForSubmission: any

  if (version === 'v0.7') {
    // v0.7 format
    const { factory, factoryData } = parseInitCode(sponsoredUserOperation.initCode)
    const paymasterInfo = parsePaymasterAndData(sponsoredUserOperation.paymasterAndData)

    userOpForSubmission = {
      sender: sponsoredUserOperation.sender,
      nonce: '0x' + sponsoredUserOperation.nonce.toString(16),
      callData: sponsoredUserOperation.callData,
      callGasLimit: '0x' + sponsoredUserOperation.callGasLimit.toString(16),
      verificationGasLimit: '0x' + sponsoredUserOperation.verificationGasLimit.toString(16),
      preVerificationGas: '0x' + sponsoredUserOperation.preVerificationGas.toString(16),
      maxFeePerGas: '0x' + sponsoredUserOperation.maxFeePerGas.toString(16),
      maxPriorityFeePerGas: '0x' + sponsoredUserOperation.maxPriorityFeePerGas.toString(16),
      signature: sponsoredUserOperation.signature,
      // v0.7 specific fields
      factory,
      factoryData,
      paymaster: paymasterInfo.paymaster,
      paymasterVerificationGasLimit: paymasterInfo.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: paymasterInfo.paymasterPostOpGasLimit,
      paymasterData: paymasterInfo.paymasterData,
    }
  } else {
    // v0.6 format (your original code)
    userOpForSubmission = {
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
    }
  }

  const options = {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 0,
      jsonrpc: '2.0',
      method: 'eth_sendUserOperation',
      params: [userOpForSubmission, entryPointAddress],
    }),
  }

  console.log('\nSending UserOperation for submission:', JSON.stringify(userOpForSubmission, null, 2))

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
    } else if (responseValues && responseValues['error']) {
      console.log('\nSubmission Error:', responseValues['error'])
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

// Helper function to check supported EntryPoints
export const getSupportedEntryPoints = async (
  chainID: number,
  apiKey: string,
) => {
  const options = {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 0,
      jsonrpc: '2.0',
      method: 'eth_supportedEntryPoints',
      params: [],
    }),
  }

  try {
    const response = await fetch(`https://api.gelato.digital//bundlers/${chainID}/rpc?sponsorApiKey=${apiKey}`, options)
    const result = await response.json()
    
    if (result && result.result) {
      console.log('Supported EntryPoints:', result.result)
      return result.result
    } else {
      console.log('Error getting supported EntryPoints:', result?.error || result)
      return []
    }
  } catch (err) {
    console.error('Error fetching supported EntryPoints:', err)
    return []
  }
}