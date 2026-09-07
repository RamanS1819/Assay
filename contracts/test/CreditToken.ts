import { expect } from 'chai';
import { ethers } from 'hardhat';

/**
 * Runs entirely on Hardhat's in-process EVM — no accounts, no faucet, no network.
 * Proves beat 5: a revoked holder's transfer reverts on-chain.
 */
describe('CreditToken', () => {
  async function deploy() {
    const [owner, agent, holderA, holderB, outsider] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('CreditToken');
    const token = await Factory.deploy('Assay Credit', 'ACR', agent.address);
    await token.waitForDeployment();
    return { token, owner, agent, holderA, holderB, outsider };
  }

  it('lets the agent issue a credit line and marks the holder eligible', async () => {
    const { token, agent, holderA } = await deploy();
    await token.connect(agent).issue(holderA.address, 1000n);
    expect(await token.balanceOf(holderA.address)).to.equal(1000n);
    expect(await token.eligible(holderA.address)).to.equal(true);
  });

  it('allows a transfer between two eligible holders', async () => {
    const { token, agent, holderA, holderB } = await deploy();
    await token.connect(agent).issue(holderA.address, 1000n);
    await token.connect(agent).setEligible(holderB.address, true);
    await expect(token.connect(holderA).transfer(holderB.address, 100n)).to.not.be.reverted;
    expect(await token.balanceOf(holderB.address)).to.equal(100n);
  });

  it('REVERTS a revoked holder\'s transfer — beat 5', async () => {
    const { token, agent, holderA, holderB } = await deploy();
    await token.connect(agent).issue(holderA.address, 1000n);
    await token.connect(agent).setEligible(holderB.address, true);

    await token.connect(agent).revoke(holderA.address);

    await expect(token.connect(holderA).transfer(holderB.address, 100n))
      .to.be.revertedWithCustomError(token, 'FromNotEligible')
      .withArgs(holderA.address);
  });

  it('reverts a transfer to a non-eligible recipient', async () => {
    const { token, agent, holderA, outsider } = await deploy();
    await token.connect(agent).issue(holderA.address, 1000n);
    await expect(token.connect(holderA).transfer(outsider.address, 100n))
      .to.be.revertedWithCustomError(token, 'ToNotEligible')
      .withArgs(outsider.address);
  });

  it('blocks non-agents from issuing or changing eligibility', async () => {
    const { token, outsider, holderA } = await deploy();
    await expect(token.connect(outsider).issue(holderA.address, 1n)).to.be.revertedWithCustomError(token, 'NotAgent');
    await expect(token.connect(outsider).setEligible(holderA.address, true)).to.be.revertedWithCustomError(token, 'NotAgent');
    await expect(token.connect(outsider).revoke(holderA.address)).to.be.revertedWithCustomError(token, 'NotAgent');
  });

  it('lets the owner rotate the agent', async () => {
    const { token, owner, outsider, holderA } = await deploy();
    await token.connect(owner).setAgent(outsider.address);
    await expect(token.connect(outsider).issue(holderA.address, 1n)).to.not.be.reverted;
    // the old agent can no longer act
  });

  it('only the owner can rotate the agent', async () => {
    const { token, outsider } = await deploy();
    await expect(token.connect(outsider).setAgent(outsider.address)).to.be.revertedWithCustomError(token, 'OwnableUnauthorizedAccount');
  });
});
