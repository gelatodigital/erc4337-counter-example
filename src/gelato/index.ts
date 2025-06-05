import dotenv from "dotenv";
import {
  SAFE_ADDRESSES_MAP,
  encodeCallData,
  getAccountAddress,
  getAccountInitCode,
} from "./safe";
import { privateKeyToAccount } from "viem/accounts";
import {
  Client,
  Hash,
  Hex,
  createPublicClient,
  http,
  zeroAddress,
  PublicClient,
  hexToBigInt,
  formatGwei,
} from "viem";
import { getAccountNonce } from "permissionless";
import { ICounter } from "../contracts";
import { ADDRESSES, ChainId } from "../constants";
import {
  UserOperation,
  getGasValuesFromGelato,
  signUserOperation,
  submitUserOperationGelato,
  getSupportedEntryPoints,
  detectEntryPointVersion,
} from "./gelato";
import { sepolia } from "viem/chains";

dotenv.config();

const privateKey = process.env.PK;
const entryPointAddress = process.env.GELATO_ENTRYPOINT_ADDRESS as `0x${string}`;
const multiSendAddress = process.env.GELATO_MULTISEND_ADDRESS as `0x${string}`;
const apiKey = process.env.GELATO_API_KEY;
const saltNonce = BigInt(process.env.GELATO_NONCE as string);

const chain = process.env.GELATO_CHAIN;
const chainID = Number(process.env.GELATO_CHAIN_ID);
const safeVersion = process.env.SAFE_VERSION as string;
const rpcURL = process.env.GELATO_RPC_URL;

// Enhanced error handling and validation
const validateEnvironment = () => {
  const required = [
    'PK',
    'GELATO_ENTRYPOINT_ADDRESS', 
    'GELATO_API_KEY',
    'GELATO_CHAIN',
    'GELATO_CHAIN_ID',
    'SAFE_VERSION',
    'GELATO_RPC_URL'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  console.log(`Environment validated. Using EntryPoint: ${entryPointAddress}`);
  console.log(`Detected version: ${detectEntryPointVersion(entryPointAddress)}`);
};

const main = async () => {
  try {
    // Validate environment first
    validateEnvironment();
    
    const safeAddresses = (
      SAFE_ADDRESSES_MAP as Record<string, Record<string, any>>
    )[safeVersion];
    
    let chainAddresses;
    if (safeAddresses) {
      chainAddresses = safeAddresses[chainID];
      if (!chainAddresses) {
        throw new Error(`No Safe addresses found for chain ID: ${chainID}`);
      }
    } else {
      throw new Error(`No Safe addresses found for version: ${safeVersion}`);
    }

    const signer = privateKeyToAccount(privateKey as Hash);
    console.log("Signer Extracted from Private Key:", signer.address);

    // Check supported EntryPoints first
    console.log("\nChecking supported EntryPoints...");
    const supportedEntryPoints = await getSupportedEntryPoints(chainID, apiKey!);
    
    if (supportedEntryPoints.length > 0) {
      console.log("Supported EntryPoints:", supportedEntryPoints);
      
      if (!supportedEntryPoints.includes(entryPointAddress)) {
        console.warn(`Warning: EntryPoint ${entryPointAddress} not in supported list`);
        console.warn("This might cause issues. Supported EntryPoints:", supportedEntryPoints);
      }
    }

    let publicClient: PublicClient;
    if (chainID == chainID) {
      publicClient = createPublicClient({
        transport: http(rpcURL),
        chain: sepolia,
      }) as PublicClient;

      // Get current gas price for better estimation
      const gasPrice = await publicClient.getGasPrice();
      console.log(`Current gas price: ${formatGwei(gasPrice)} gwei`);

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
      });
      console.log("Init Code Created.");
      console.log("Init Code length:", initCode.length);

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
      });
      console.log("Counterfactual Sender Address Created:", senderAddress);
      console.log(
        "Address Link: https://" +
          chain! +
          ".etherscan.io/address/" +
          senderAddress
      );

      const contractCode = await publicClient.getBytecode({
        address: senderAddress,
      });

      if (contractCode) {
        console.log("The Safe is already deployed.");
      } else {
        console.log(
          "Deploying a new Safe and executing calldata passed with it (if any)."
        );
      }

      const newNonce = await getAccountNonce(publicClient as Client, {
        entryPoint: entryPointAddress,
        sender: senderAddress,
      });
      console.log("Nonce for the sender received from EntryPoint:", newNonce);

      console.log("Chain ID:", chainID);
      const counter = ADDRESSES[chainID as ChainId].counter;
      if (!counter) {
        throw new Error(`No counter contract found for chain ID: ${chainID}`);
      }
      
      const txCallData = encodeCallData({
        to: counter as Hex,
        data: ICounter.encodeFunctionData("increment") as Hex,
        value: 0n,
      });
      console.log("Transaction call data encoded.");

      // Better gas price estimation
      const maxFeePerGas = gasPrice * 2n; // 2x current gas price
      const maxPriorityFeePerGas = gasPrice / 10n; // 10% tip

      // Create UserOperation with initial values for signing
      let sponsoredUserOperation: UserOperation = {
        sender: senderAddress as `0x${string}`,
        nonce: newNonce,
        initCode: contractCode ? "0x" : initCode,
        callData: txCallData,
        callGasLimit: 0n, // Set to 0 for estimation
        verificationGasLimit: 0n, // Set to 0 for estimation
        preVerificationGas: 0n, // Set to 0 for estimation
        maxFeePerGas: 1n, // Set to 1 for estimation
        maxPriorityFeePerGas: 1n, // Set to 1 for estimation
        paymasterAndData: "0x" as `0x${string}`,
        signature: "0x" as `0x${string}`, // Will be filled by signing
      };

      console.log("Initial UserOperation values set for v0.7 gas estimation");

      // Sign the UserOperation first with reasonable gas estimates
      console.log("Signing UserOperation for gas estimation...");
      sponsoredUserOperation.signature = await signUserOperation(
        sponsoredUserOperation,
        signer,
        chainID,
        entryPointAddress,
        chainAddresses.SAFE_4337_MODULE_ADDRESS
      );
      console.log("UserOperation signed with temporary gas values.");

      console.log("Getting gas estimation with real signature...");
      const rvGas = await getGasValuesFromGelato(
        entryPointAddress,
        sponsoredUserOperation,
        chainID,
        apiKey!
      );

      if (!rvGas) {
        throw new Error("Failed to get gas estimation from Gelato");
      }

      console.log("Gas estimation received:", rvGas);

      // Update UserOperation with accurate gas values
      // Helper function to safely convert hex to bigint
      const safeHexToBigInt = (hexValue: string): bigint => {
        // Remove any double 0x prefixes
        const cleanHex = hexValue.replace(/^0x0x/, '0x');
        return hexToBigInt(cleanHex as `0x${string}`);
      };

      // Handle Gelato's 1Balance sponsoring where preVerificationGas might be 0
      if (rvGas.preVerificationGas && rvGas.preVerificationGas !== '0x0') {
        sponsoredUserOperation.preVerificationGas = safeHexToBigInt(rvGas.preVerificationGas);
      } else {
        console.log("preVerificationGas is 0 (expected for Gelato 1Balance sponsoring)");
        // Keep the initial reasonable value for sponsored transactions
        // sponsoredUserOperation.preVerificationGas stays as set initially
      }
      
      if (rvGas.callGasLimit) {
        sponsoredUserOperation.callGasLimit = safeHexToBigInt(rvGas.callGasLimit);
      }
      if (rvGas.verificationGasLimit) {
        sponsoredUserOperation.verificationGasLimit = safeHexToBigInt(rvGas.verificationGasLimit);
      }

      // Add some buffer to gas limits for safety (10% extra)
      sponsoredUserOperation.callGasLimit = (sponsoredUserOperation.callGasLimit * 110n) / 100n;
      sponsoredUserOperation.verificationGasLimit = (sponsoredUserOperation.verificationGasLimit * 110n) / 100n;

      console.log("Final gas values:");
      console.log("- preVerificationGas:", sponsoredUserOperation.preVerificationGas.toString(), "(Gelato 1Balance: fees settled post-execution)");
      console.log("- callGasLimit:", sponsoredUserOperation.callGasLimit.toString());
      console.log("- verificationGasLimit:", sponsoredUserOperation.verificationGasLimit.toString());
      console.log("- maxFeePerGas:", sponsoredUserOperation.maxFeePerGas.toString());
      console.log("- maxPriorityFeePerGas:", sponsoredUserOperation.maxPriorityFeePerGas.toString());

      // Re-sign the UserOperation with final gas values
      console.log("Re-signing UserOperation with final gas values...");
      sponsoredUserOperation.signature = await signUserOperation(
        sponsoredUserOperation,
        signer,
        chainID,
        entryPointAddress,
        chainAddresses.SAFE_4337_MODULE_ADDRESS
      );
      console.log("Final signature:", sponsoredUserOperation.signature);

      // Calculate estimated cost
      const estimatedCost = 
        (sponsoredUserOperation.callGasLimit + 
         sponsoredUserOperation.verificationGasLimit + 
         sponsoredUserOperation.preVerificationGas) * 
        sponsoredUserOperation.maxFeePerGas;
      
      console.log(`Estimated transaction cost: ${formatGwei(estimatedCost)} gwei`);

      // Submit the UserOperation
      console.log("Submitting UserOperation...");
      await submitUserOperationGelato(
        entryPointAddress,
        sponsoredUserOperation,
        chain!,
        chainID,
        apiKey!
      );

      console.log("Process completed successfully!");

    } else {
      throw new Error("Invalid chain configuration");
    }
    
  } catch (error) {
    console.error("Error in main execution:");
    console.error(error);
    
    // More detailed error logging
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    
    throw error;
  }
};

main().catch((error) => {
  console.error("Fatal error:");
  console.error(error);
  process.exitCode = 1;
});