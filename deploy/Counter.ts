import { DeployFunction } from "hardhat-deploy/types";
import hre from "hardhat";

const isHardhat = hre.network.name === "hardhat";

const func: DeployFunction = async () => {
  const accounts = await hre.getNamedAccounts();

  await hre.deployments.deploy("Counter", {
    from: accounts.deployer,
    log: !isHardhat,
  });
};

func.tags = ["Counter"];

export default func;
