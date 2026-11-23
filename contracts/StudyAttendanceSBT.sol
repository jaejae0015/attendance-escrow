// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title IERC5192
 * @notice ERC-5192 Minimal Soulbound NFTs.
 * @dev https://eips.ethereum.org/EIPS/eip-5192
 */
interface IERC5192 {
    /// @notice 토큰이 잠긴 상태로 민팅되거나 잠금으로 전환될 때 발생한다.
    event Locked(uint256 tokenId);

    /// @notice 잠금이 해제될 때 발생한다. 이 컬렉션은 해제하지 않는다.
    event Unlocked(uint256 tokenId);

    /// @notice 영혼귀속 잠금 여부. 존재하는 토큰은 항상 true다.
    function locked(uint256 tokenId) external view returns (bool);
}

/**
 * @title StudyAttendanceSBT
 * @notice 스터디 출석 배지. ERC-721을 상속하고 ERC-5192로 양도를 막는다.
 * @dev 배포자가 setMinter로 StudyEscrow를 연결한 뒤부터 그 주소만 mint/burn/reassign을 호출할 수 있다.
 *      개근 배지의 roundId는 8이다.
 */
contract StudyAttendanceSBT is ERC721, IERC5192 {
    /// @notice 7회 개근 배지를 구분하는 회차 번호.
    uint8 public constant PERFECT_ROUND = 8;

    /// @notice setMinter를 한 번 호출할 수 있는 배포자.
    address public immutable owner;

    /// @notice 유일한 민팅·소각 권한을 가진 에스크로 컨트랙트.
    address public escrow;

    struct Badge {
        uint8 roundId;
        uint256 attestCount;
        bool perfect;
    }

    uint256 public nextTokenId;
    mapping(uint256 tokenId => Badge) private _badges;

    /// @dev 지갑 교체 시 에스크로가 좌석의 배지를 새 주소로 옮기는 동안만 true.
    bool private _reassigning;

    error OnlyEscrow();
    error OnlyOwner();
    error ZeroAddress();
    error MinterAlreadySet();
    error SoulboundTokenLocked(uint256 tokenId);

    event MinterUpdated(address indexed minter);

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert OnlyEscrow();
        _;
    }

    constructor() ERC721("Study Attendance SBT", "SATT") {
        owner = msg.sender;
    }

    /// @notice 민팅 권한을 StudyEscrow 주소로 한 번만 연결한다.
    function setMinter(address newMinter) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (newMinter == address(0)) revert ZeroAddress();
        if (escrow != address(0)) revert MinterAlreadySet();
        escrow = newMinter;
        emit MinterUpdated(newMinter);
    }

    /// @inheritdoc ERC721
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }

    /**
     * @notice 잠금 여부. 존재하는 배지는 항상 잠겨 있다.
     * @dev 존재하지 않는 tokenId는 revert한다.
     */
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    /// @notice 배지에 기록된 회차, 확인해 준 횟수, 개근 여부.
    function badge(uint256 tokenId)
        external
        view
        returns (uint8 roundId, uint256 attestCount, bool perfect, bool isLocked)
    {
        _requireOwned(tokenId);
        Badge storage data = _badges[tokenId];
        return (data.roundId, data.attestCount, data.perfect, true);
    }

    /**
     * @notice 출석 또는 개근 배지를 발급한다.
     * @param to 수령 주소.
     * @param roundId 1~7은 해당 회차 출석, 8은 개근.
     * @param attestCount 그 회차에 다른 스터디원 증빙을 확인해 준 횟수. 개근 배지는 누적 횟수.
     */
    function mint(address to, uint8 roundId, uint256 attestCount) external onlyEscrow returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        tokenId = ++nextTokenId;
        _mint(to, tokenId);
        _badges[tokenId] = Badge({roundId: roundId, attestCount: attestCount, perfect: roundId == PERFECT_ROUND});
        emit Locked(tokenId);
    }

    /// @notice 허위 증빙으로 확정된 배지를 소각한다.
    function burn(uint256 tokenId) external onlyEscrow {
        _burn(tokenId);
        delete _badges[tokenId];
    }

    /**
     * @notice 지갑 교체 의결이 실행될 때 같은 좌석의 배지 소유자만 바꾼다.
     * @dev 일반 전송 경로는 그대로 잠겨 있다. 에스크로만 이 함수로 우회한다.
     */
    function reassign(uint256 tokenId, address to) external onlyEscrow {
        if (to == address(0)) revert ZeroAddress();
        _reassigning = true;
        _transfer(_requireOwned(tokenId), to, tokenId);
        _reassigning = false;
    }

    /// @inheritdoc ERC721
    function transferFrom(address, address, uint256 tokenId) public pure override {
        revert SoulboundTokenLocked(tokenId);
    }

    /**
     * @inheritdoc ERC721
     * @dev OpenZeppelin v5의 3-인자 safeTransferFrom은 virtual이 아니며 이 함수로 위임하므로 함께 revert된다.
     */
    function safeTransferFrom(address, address, uint256 tokenId, bytes memory) public pure override {
        revert SoulboundTokenLocked(tokenId);
    }

    /// @dev 민팅(from == 0)과 소각(to == 0), 에스크로의 reassign만 상태 변경을 허용한다.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && !_reassigning) {
            revert SoulboundTokenLocked(tokenId);
        }
        return super._update(to, tokenId, auth);
    }
}
