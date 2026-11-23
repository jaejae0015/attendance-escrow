// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title StudyDepositToken
 * @notice 스터디 보증금 시연용 ERC-20. 소수점은 18자리이며, faucet으로 1인 보증금(35,000 SDT)을 바로 민팅할 수 있다.
 */
contract StudyDepositToken is ERC20 {
    /// @notice faucet 1회 호출 시 민팅되는 수량. 1인 총 보증금과 같다.
    uint256 public constant FAUCET_AMOUNT = 35_000 ether;

    constructor() ERC20("Study Deposit Token", "SDT") {}

    /// @inheritdoc ERC20
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /// @notice 호출자에게 35,000 SDT를 민팅한다. 시연용이며 횟수 제한이 없다.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
