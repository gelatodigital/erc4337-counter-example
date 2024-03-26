import { ethers } from "ethers";
import { ICounter } from "../contracts";
import { ZERODEV_API, ADDRESSES, ChainId } from "../constants";
import { ZeroDevEthersProvider, convertEthersSignerToAccountSigner } from "@zerodev/sdk";

import dotenv from 'dotenv';

dotenv.config();

const main = async () => {
  const ZERODEV_PROJECT_ID = process.env.ZERODEV_PROJECT_ID;
  if (!ZERODEV_PROJECT_ID) throw new Error("ZERODEV_PROJECT_ID missing in .env");

  const wallet = ethers.Wallet.createRandom();

  const { chainId } = await fetch(`${ZERODEV_API}/projects/${ZERODEV_PROJECT_ID}`)
    .then(res => res.json());

  if (!ADDRESSES[chainId as ChainId])
    throw new Error(`Counter contract not deployed on chainId: ${chainId}`);

  const provider = await ZeroDevEthersProvider.init("ECDSA", {
    projectId: ZERODEV_PROJECT_ID,
    owner: convertEthersSignerToAccountSigner(wallet),
    bundlerProvider: "GELATO",
  });

  const counter = ADDRESSES[chainId as ChainId].counter;
  const increment = ICounter.encodeFunctionData("increment");
  const account = provider.getAccountProvider();

  const userOp = {
    target: counter as `0x{string}`,
    data: increment as `0x{string}`,
  };

  // can batch multiple UserOps by passing in an array instead
  const { hash } = await account.sendUserOperation(userOp);

  console.log(`userOpHash: ${hash}`);

  const transaction = await account.waitForUserOperationTransaction(hash as `0x{string}`);
  console.log(`transactionHash: ${transaction}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
