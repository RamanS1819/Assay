// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  Assay CreditToken
 * @notice A tokenized credit line whose transfers are gated by an on-chain
 *         eligibility control list. The `agent` (a Privy server wallet) is the
 *         only address that may issue credit or change eligibility.
 *
 *         A revoked holder's next transfer REVERTS on-chain. That revert is the
 *         demo: a transfer fails because two tenths of a cent were spent off-chain
 *         to re-score the holder after a liquidation.
 *
 *         eligibility flow
 *         ----------------
 *         issue(holder)   -> eligible[holder] = true,  _mint
 *         revoke(holder)  -> eligible[holder] = false
 *         transfer        -> require eligible[from] && eligible[to]  (mint/burn exempt)
 */
contract CreditToken is ERC20, Ownable {
    /// @notice The control list. Only eligible addresses may send or receive.
    mapping(address => bool) public eligible;

    /// @notice The agent authorized to issue and change eligibility.
    address public agent;

    event AgentChanged(address indexed agent);
    event EligibilitySet(address indexed holder, bool eligible);
    event Issued(address indexed to, uint256 amount);

    error NotAgent();
    error FromNotEligible(address from);
    error ToNotEligible(address to);

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(string memory name_, string memory symbol_, address agent_)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        agent = agent_;
        emit AgentChanged(agent_);
    }

    /// @notice Owner rotates the agent (e.g. a new Privy wallet).
    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
        emit AgentChanged(agent_);
    }

    /// @notice Grant or clear a holder's eligibility.
    function setEligible(address holder, bool value) external onlyAgent {
        eligible[holder] = value;
        emit EligibilitySet(holder, value);
    }

    /// @notice Revoke a holder. Its next transfer reverts. (Convenience for the demo.)
    function revoke(address holder) external onlyAgent {
        eligible[holder] = false;
        emit EligibilitySet(holder, false);
    }

    /// @notice Mint a credit line to a holder and mark it eligible.
    function issue(address to, uint256 amount) external onlyAgent {
        eligible[to] = true;
        emit EligibilitySet(to, true);
        _mint(to, amount);
        emit Issued(to, amount);
    }

    /// @dev Gate every peer-to-peer transfer on the control list. Mint (from == 0)
    ///      and burn (to == 0) bypass the gate so issue/redeem keep working.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (!eligible[from]) revert FromNotEligible(from);
            if (!eligible[to]) revert ToNotEligible(to);
        }
        super._update(from, to, value);
    }
}
