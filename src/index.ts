import { ethers } from "ethers";
import { ICounter } from "./contracts";
import { GELATO_API, ZERODEV_API, ADDRESSES, ChainId } from "./constants";
import { ZeroDevEthersProvider, convertEthersSignerToAccountSigner} from "@zerodev/sdk";

import dotenv from 'dotenv';
dotenv.config();

const main = async () => {
	const ONEBALANCE_API_KEY = process.env.ONEBALANCE_API_KEY;
   const ZERODEV_PROJECT_ID = process.env.ZERODEV_PROJECT_ID;

	if (!ONEBALANCE_API_KEY) throw new Error("ONEBALANCE_API_KEY missing in .env");
   if (!ZERODEV_PROJECT_ID) throw new Error("ZERODEV_PROJECT_ID missing in .env");

	const wallet = ethers.Wallet.createRandom();

	const { chainId } = await fetch(`${ZERODEV_API}/projects/${ZERODEV_PROJECT_ID}`)
		.then(res => res.json());

	if (!ADDRESSES[chainId as ChainId])
		throw new Error(`Counter contract not deployed on chainId: ${chainId}`);

	const provider = await ZeroDevEthersProvider.init("ECDSA", {
		projectId: ZERODEV_PROJECT_ID,
		usePaymaster: false,
		owner: convertEthersSignerToAccountSigner(wallet),
		opts: {
			providerConfig: {
				rpcUrl: `${GELATO_API}/bundlers/${chainId}/rpc?sponsorApiKey=${ONEBALANCE_API_KEY}`,
			},
		},
	});

	const counter = ADDRESSES[chainId as ChainId].counter;
	const increment = ICounter.encodeFunctionData("increment");

	const account = provider.getAccountProvider();

	const { hash } = await account.sendUserOperation({
		target: counter as `0x{string}`,
		data: increment as `0x{string}`,
	}, {
		maxFeePerGas: 0n,
	});

	console.log(`userOpHash: ${hash}`);

	const transaction = await account.waitForUserOperationTransaction(hash as `0x{string}`);
	console.log(`transactionHash: ${transaction}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
