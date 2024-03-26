import { createSmartAccountClient } from "permissionless"
import { signerToSafeSmartAccount } from "permissionless/accounts"
import {
	createPimlicoBundlerClient,
	createPimlicoPaymasterClient,
} from "permissionless/clients/pimlico"
import { Hex, createPublicClient, getContract, http, parseEther } from "viem"
import { polygonMumbai } from "viem/chains"

import { privateKeyToAccount } from "viem/accounts"
 

import dotenv from 'dotenv';
dotenv.config();


export const publicClient = createPublicClient({
	transport: http("https://polygon-mumbai.g.alchemy.com/v2/_HsuvYjrWX8zIZS6oAXPWU8OR1IyNYy-"),
})
 
export const paymasterClient = createPimlicoPaymasterClient({
	transport: http("https://api.pimlico.io/v2/mumbai/rpc?apikey=e1e0628d-46d6-40df-8f38-d08973189b1a"),
})

export const bundlerClient = createPimlicoBundlerClient({
	transport: http("https://api.pimlico.io/v1/mumbai/rpc?apikey=e1e0628d-46d6-40df-8f38-d08973189b1a"),
})


export const main = async () => {

const PK = process.env.PK;
const signer = privateKeyToAccount(PK as Hex) as any

const safeAccount = await signerToSafeSmartAccount(publicClient, {
	entryPoint: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", // global entrypoint
	signer: signer,
    safeVersion: "1.4.1",
    address:"0xEF844dCAF6ce547D8c6B7e9D4A117fE64Be6B908"
//	address: "0x...", // optional, only if you are using an already created account
})


const smartAccountClient = createSmartAccountClient({
	account: safeAccount,
	chain: polygonMumbai,
	transport: http("https://api.pimlico.io/v1/mumbai/rpc?apikey=e1e0628d-46d6-40df-8f38-d08973189b1a"),
	sponsorUserOperation: paymasterClient.sponsorUserOperation, // optional
})


 
const gasPrices = await bundlerClient.getUserOperationGasPrice();

const txHash = await smartAccountClient.sendTransaction({
    chain:polygonMumbai,
	to: "0x903918bB1903714E0518Ea2122aCeBfa27f11b6F",
	value: parseEther("0.1"),
	maxFeePerGas:  gasPrices.fast.maxFeePerGas, // if using Pimlico
	maxPriorityFeePerGas: gasPrices.fast.maxPriorityFeePerGas, // if using Pimlico
})

console.log(txHash)

}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
  });
