import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("배포된 컨트랙트 형태", function () {
  it("토큰, 출석 배지, 에스크로가 연결되고 스터디 생성 전 상태는 0이다", async function () {
    const [deployer, a, b, c, d, e, f] = await ethers.getSigners();
    const token = await ethers.deployContract("StudyDepositToken");
    const sbt = await ethers.deployContract("StudyAttendanceSBT");
    const escrow = await ethers.deployContract("StudyEscrow", [await token.getAddress(), await sbt.getAddress()]);
    await (await sbt.setMinter(await escrow.getAddress())).wait();

    expect(await escrow.status()).to.equal(0n);
    expect(await escrow.token()).to.equal(await token.getAddress());
    expect(await escrow.sbt()).to.equal(await sbt.getAddress());
    expect(await sbt.escrow()).to.equal(await escrow.getAddress());

    await (await token.connect(a).faucet()).wait();
    expect(await token.balanceOf(a.address)).to.equal(await token.FAUCET_AMOUNT());

    await (await escrow.createStudy([a.address, b.address, c.address, d.address, e.address, f.address])).wait();
    expect(await escrow.status()).to.equal(1n);
    const overview = await escrow.getStudyOverview();
    expect(overview.depositToken).to.equal(await token.getAddress());
    expect(overview.attendanceSbt).to.equal(await sbt.getAddress());
    expect(overview.memberAccounts[0]).to.equal(a.address);
  });
});
