import dotenv from "dotenv";
import { SAFE_ADDRESSES_MAP, encodeCallData, getAccountAddress, getAccountInitCode } from "./safe";
import { privateKeyToAccount } from "viem/accounts";
import { Client, Hash, Hex, createPublicClient, http, zeroAddress, PublicClient } from 'viem'
import { getAccountNonce } from 'permissionless'
import { ICounter } from "../contracts";
import { ADDRESSES, ChainId } from "../constants";
import { UserOperation, getGasValuesFromGelato, signUserOperation, submitUserOperationGelato } from "./gelato";
import { sepolia } from 'viem/chains'
dotenv.config();
const privateKey = process.env.PK;
const entryPointAddress = process.env.GELATO_ENTRYPOINT_ADDRESS as `0x${string}`
const multiSendAddress = process.env.GELATO_MULTISEND_ADDRESS as `0x${string}`
const apiKey = process.env.GELATO_API_KEY
const saltNonce = BigInt(process.env.GELATO_NONCE as string)

const chain = process.env.GELATO_CHAIN
const chainID = Number(process.env.GELATO_CHAIN_ID)
const safeVersion = process.env.SAFE_VERSION as string
const rpcURL = process.env.GELATO_RPC_URL


const main = async () => {

  const safeAddresses = (
    SAFE_ADDRESSES_MAP as Record<string, Record<string, any>>
  )[safeVersion];
  let chainAddresses;
  if (safeAddresses) {
    chainAddresses = safeAddresses[chainID];
  }

  const signer = privateKeyToAccount(privateKey as Hash);
  console.log("Signer Extracted from Private Key.");

  let publicClient:PublicClient;
  if (chainID == chainID) {
    publicClient = createPublicClient({
      transport: http(rpcURL),
      chain: sepolia,
    }) as PublicClient


    const initCode = await getAccountInitCode({
      owner: signer.address,
      addModuleLibAddress: chainAddresses.ADD_MODULES_LIB_ADDRESS,
      safe4337ModuleAddress: chainAddresses.SAFE_4337_MODULE_ADDRESS,
      safeProxyFactoryAddress: chainAddresses.SAFE_PROXY_FACTORY_ADDRESS,
      safeSingletonAddress: chainAddresses.SAFE_SINGLETON_ADDRESS,
      saltNonce: saltNonce,
      multiSendAddress: multiSendAddress,
      erc20TokenAddress: zeroAddress,
      paymasterAddress: zeroAddress,
    })
    console.log('\nInit Code Created.')
    
    const senderAddress = await getAccountAddress({
      client: publicClient,
      owner: signer.address,
      addModuleLibAddress: chainAddresses.ADD_MODULES_LIB_ADDRESS,
      safe4337ModuleAddress: chainAddresses.SAFE_4337_MODULE_ADDRESS,
      safeProxyFactoryAddress: chainAddresses.SAFE_PROXY_FACTORY_ADDRESS,
      safeSingletonAddress: chainAddresses.SAFE_SINGLETON_ADDRESS,
      saltNonce: saltNonce,
      multiSendAddress: multiSendAddress,
      erc20TokenAddress: zeroAddress,
      paymasterAddress: zeroAddress,
    })
    console.log('\nCounterfactual Sender Address Created:', senderAddress)
    console.log('Address Link: https://' + chain! + '.etherscan.io/address/' + senderAddress)
    
    const contractCode = await publicClient.getBytecode({ address: senderAddress })

if (contractCode) {
  console.log('\nThe Safe is already deployed.')
} else {
  console.log('\nDeploying a new Safe and executing calldata passed with it (if any).')
}

const newNonce = await getAccountNonce(publicClient as Client, {
  entryPoint: entryPointAddress,
  sender: senderAddress,
})
console.log('\nNonce for the sender received from EntryPoint.')


console.log(chainID)
const counter = ADDRESSES[chainID as ChainId].counter;
const txCallData = encodeCallData({
  to: counter as Hex,
  data: ICounter.encodeFunctionData("increment") as Hex, // safeMint() function call with corresponding data.
  value: 0n,
})

const sponsoredUserOperation: any = {
  sender: senderAddress,
  nonce: newNonce,
  initCode: contractCode ? '0x' : initCode,
  callData: txCallData,
  callGasLimit: 1n, // All Gas Values will be filled by Estimation Response Data.
  verificationGasLimit: 1n,
  preVerificationGas: 1n,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 1n,
  paymasterAndData: "0x",
  // oadding dummy signature
  signature: '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'

}


// MANDATORY for 1 BALANCE
sponsoredUserOperation.maxPriorityFeePerGas = 0n 
sponsoredUserOperation.maxFeePerGas = 0n

const rvGas = await getGasValuesFromGelato(entryPointAddress, sponsoredUserOperation, chainID, apiKey!)
sponsoredUserOperation.preVerificationGas = rvGas?.preVerificationGas
sponsoredUserOperation.callGasLimit = rvGas?.callGasLimit
sponsoredUserOperation.verificationGasLimit = rvGas?.verificationGasLimit



// SIGNING USER OPERATION
sponsoredUserOperation.signature = await signUserOperation(
sponsoredUserOperation,
signer,
chainID,
entryPointAddress,
chainAddresses.SAFE_4337_MODULE_ADDRESS,
)
console.log('\nSigned Real Data for Gelato.')
console.log(sponsoredUserOperation.signature)


// SIGNING USER OPERATION
await submitUserOperationGelato(entryPointAddress, sponsoredUserOperation,chain!, chainID, apiKey!)


};
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
