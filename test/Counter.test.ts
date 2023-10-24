import { deployments, ethers } from "hardhat";
import { Counter, Counter__factory } from "../typechain";
import { ECDSAProvider } from "@zerodev/sdk";
import { assert, expect } from "chai";

import * as dotenv from "dotenv";
dotenv.config({ path: __dirname + "/.env" });

describe("Counter", () => {
  let counter: Counter;
  let provider: ECDSAProvider;
  let chainId: bigint;

  before(async () => {
    const ONEBALANCE_API_KEY = process.env.ONEBALANCE_API_KEY;
    const ZERODEV_PROJECT_ID = process.env.ZERODEV_PROJECT_ID;
    const GELATO_API_URL =
      process.env.GELATO_API_URL ?? "https://api.gelato.digital";

    if (!ONEBALANCE_API_KEY) throw new Error("ONEBALANCE_KEY missing in .env");
    if (!ZERODEV_PROJECT_ID)
      throw new Error("ZERODEV_PROJECT_ID missing in .env");

    await deployments.fixture();

    const { address } = await deployments.get("Counter");
    counter = Counter__factory.connect(address, ethers.provider);

    const wallet = ethers.Wallet.createRandom();
    const network = await ethers.provider.getNetwork();
    chainId = network.chainId;

    provider = await ECDSAProvider.init({
      projectId: ZERODEV_PROJECT_ID,
      usePaymaster: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      owner: wallet as any,
      opts: {
        providerConfig: {
          rpcUrl: `${GELATO_API_URL}/bundlers/${chainId}/rpc?sponsorApiKey=${ONEBALANCE_API_KEY}`,
        },
      },
    });
  });

  const increment = async () => {
    const tx = await counter.increment.populateTransaction();

    const { hash } = await provider.sendUserOperation(
      {
        target: tx.to as `0x{string}`,
        data: tx.data as `0x{string}`,
      },
      {
        maxFeePerGas: 0n,
      },
    );

    console.log("userOpHash:", hash);

    let receipt;
    while (!receipt) {
      await new Promise((r) => setTimeout(r, 3000));
      receipt = await provider.getUserOperationReceipt(hash as `0x{string}`);
    }

    if (!receipt.success) {
      assert.fail(`Error: ${receipt.reason}`);
    } else {
      console.log("transactionHash:", receipt.receipt.transactionHash);
    }
  };

  it("chainId", async () => {
    await expect(chainId).to.equal(BigInt(provider.rpcClient.chain.id));
  });

  it("deploy account & increment counter", async () => {
    await increment();

    const address = await provider.getAddress();
    const count = await counter.counter(address);
    expect(count).to.equal(1n);
  }).timeout(300000);

  it("increment counter", async () => {
    await increment();

    const address = await provider.getAddress();
    const count = await counter.counter(address);
    expect(count).to.equal(2n);
  }).timeout(300000);
});
