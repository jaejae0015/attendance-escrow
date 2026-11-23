import { network } from "hardhat";

const SEPOLIA_CHAIN_ID = 11155111n;

const { ethers } = await network.create();
const [deployer] = await ethers.getSigners();
const chainId = (await ethers.provider.getNetwork()).chainId;

if (chainId !== SEPOLIA_CHAIN_ID) {
  throw new Error(`Sepolia(chainId ${SEPOLIA_CHAIN_ID})가 아닙니다. 현재 chainId=${chainId}`);
}

console.log("Deployer:", deployer.address);

const token = await ethers.deployContract("StudyDepositToken");
await token.waitForDeployment();
const tokenAddress = await token.getAddress();

const sbt = await ethers.deployContract("StudyAttendanceSBT");
await sbt.waitForDeployment();
const sbtAddress = await sbt.getAddress();

const escrow = await ethers.deployContract("StudyEscrow", [tokenAddress, sbtAddress]);
await escrow.waitForDeployment();
const escrowAddress = await escrow.getAddress();

const minterTx = await sbt.setMinter(escrowAddress);
await minterTx.wait();

if ((await sbt.escrow()) !== escrowAddress) {
  throw new Error("StudyAttendanceSBT minter가 StudyEscrow에 연결되지 않았습니다.");
}

console.log("");
console.log("Sepolia deployment");
console.log("StudyDepositToken   ", tokenAddress);
console.log("StudyAttendanceSBT  ", sbtAddress);
console.log("StudyEscrow         ", escrowAddress);
