// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StudyAttendanceSBT} from "./StudyAttendanceSBT.sol";

/**
 * @title StudyEscrow
 * @notice 6인 7회차 스터디의 SDT 보증금 에스크로.
 *         출석은 본인을 제외한 5명 중 3명의 확인(3-of-5)으로 인정하고,
 *         정산금은 컨트랙트가 밀어 보내지 않고 withdraw()로 당겨 간다.
 *
 * - 1인 예치 35,000 SDT = 회차 몫 5,000 SDT x 7
 * - 생성 후 72시간 안에 6명이 모두 예치해야 시작. 미달이면 전액 환불
 * - 정시 제출 + 확인 3표: 5,000 SDT와 몰수분 분배
 * - 마감 후 24시간 이내 제출(지각) + 확인 3표: 2,500 SDT만 환급
 * - 결석 몫과 지각 몰수 50%는 그 회차 정시 출석자에게 균등 분배
 * - 정시 출석자가 없으면 몰수분은 다음 회차로 이월
 * - 중도 탈퇴자의 남은 회차 몫은 각 회차 결석분으로 그 회차 출석자에게 분배
 */
contract StudyEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant MEMBER_COUNT = 6;
    uint8 public constant TOTAL_ROUNDS = 7;
    uint8 public constant ATTEST_THRESHOLD = 3;
    uint8 public constant EXCUSED_YES = 3;
    uint8 public constant FALSE_PROOF_YES = 3;
    uint8 public constant WALLET_YES = 4;
    uint8 public constant PERFECT_ROUND = 8;

    uint256 public constant ROUND_SHARE = 5_000 ether;
    uint256 public constant HALF_SHARE = ROUND_SHARE / 2;
    uint256 public constant DEPOSIT_AMOUNT = ROUND_SHARE * TOTAL_ROUNDS;

    uint256 public constant DEPOSIT_WINDOW = 3 days;
    uint256 public constant LATE_GRACE = 24 hours;
    uint256 public constant ATTEST_WINDOW = 48 hours;
    uint256 public constant DISPUTE_DELAY = 24 hours;
    uint256 public constant VOTING_PERIOD = 24 hours;
    uint256 public constant FINALIZE_DELAY = 7 days;

    uint8 internal constant ABSENT = 0;
    uint8 internal constant ON_TIME = 1;
    uint8 internal constant LATE = 2;

    enum Status {
        None,
        Created,
        Active,
        Cancelled,
        Finalized
    }

    enum ProposalType {
        ExcusedAbsence,
        FalseProof,
        WalletReplace
    }

    struct Round {
        uint64 submitDeadline;
        uint64 attestDeadline;
        uint64 disputeUntil;
        uint64 settledAt;
        bool opened;
        bool settled;
        bool disputeOpen;
        uint8 onTimeCount;
        uint8 lateCount;
        uint8 absentCount;
        uint256 distributed;
        bytes32[6] proofHashes;
        uint64[6] submittedAt;
        bool[6] submitted;
        bool[6] late;
        bool[6] excused;
        bool[6] fraud;
        bool[6] attesterPenalized;
        uint8[6] attestCount;
        uint8[6] attestsGiven;
    }

    struct Proposal {
        ProposalType proposalType;
        uint8 proposerIndex;
        uint8 targetIndex;
        address newWallet;
        uint8 roundId;
        uint64 deadline;
        uint8 yesVotes;
        uint8 noVotes;
        bool executed;
        bool exists;
    }

    struct StudyOverview {
        Status status;
        address[6] memberAccounts;
        bool[6] depositedFlags;
        bool[6] hasLeft;
        uint8[6] leaveFromRound;
        uint64 createdAt;
        uint64 depositDeadline;
        uint8 currentRound;
        uint256 carryOver;
        uint256 escrowBalance;
        uint256 outstandingClaims;
        bool isFinalized;
        address attendanceSbt;
        address depositToken;
    }

    struct RoundView {
        uint64 submitDeadline;
        uint64 attestDeadline;
        uint64 disputeUntil;
        uint64 settledAt;
        bool opened;
        bool settled;
        bool disputeOpen;
        uint8 onTimeCount;
        uint8 lateCount;
        uint8 absentCount;
        uint256 distributed;
        bytes32[6] proofHashes;
        uint64[6] submittedAt;
        bool[6] submitted;
        bool[6] late;
        bool[6] excused;
        bool[6] fraud;
        bool[6] attesterPenalized;
        uint8[6] attestCount;
        uint8[6] attestsGiven;
        bool[6] attendedRound;
    }

    struct SubmissionView {
        bool submitted;
        bool late;
        bool excused;
        bool fraud;
        bool recognized;
        bytes32 proofHash;
        uint64 submittedAt;
        uint8 attestCount;
        uint8 attestsGiven;
        bool[6] attestedBySeat;
        uint256 roundPayout;
        uint256 badgeTokenId;
    }

    IERC20 public immutable token;
    StudyAttendanceSBT public immutable sbt;

    Status public status;
    address[6] public members;
    mapping(address account => uint8 indexPlusOne) public memberIndexPlusOne;

    uint64 public createdAt;
    uint64 public depositDeadline;
    uint8 public depositedCount;
    uint8 public currentRound;
    uint256 public carryOver;
    uint256 public totalClaimable;
    bool public finalized;

    mapping(uint8 index => bool) public deposited;
    mapping(uint8 index => bool) public leftSeat;
    mapping(uint8 index => uint8 roundId) public leftFromRound;
    mapping(uint8 index => uint256 amount) public claimable;
    mapping(uint8 roundId => Round) internal rounds;
    mapping(uint8 roundId => mapping(uint8 attester => mapping(uint8 subject => bool))) public hasAttested;
    mapping(uint8 roundId => mapping(uint8 index => bool)) public attended;
    mapping(uint8 roundId => mapping(uint8 index => uint256 amount)) public roundPayout;
    mapping(uint8 roundId => mapping(uint8 index => uint256 tokenId)) public badgeId;
    mapping(uint8 index => uint256 tokenId) public perfectBadge;
    mapping(uint8 index => uint256 count) public totalAttestsGiven;

    uint256 public proposalCount;
    mapping(uint256 proposalId => Proposal) internal proposals;
    mapping(uint256 proposalId => mapping(uint8 index => bool)) public voted;

    event Deposited(address indexed member, uint256 amount);
    event ProofSubmitted(uint256 indexed roundId, address indexed member, bytes32 proofHash, bool late);
    event Attested(uint256 indexed roundId, address indexed attester, address indexed member);
    event RoundSettled(
        uint256 indexed roundId, uint256 onTimeCount, uint256 lateCount, uint256 absentCount, uint256 distributedPot
    );
    event Distributed(uint256 indexed roundId, address indexed member, uint256 amount);
    event DisputeOpened(uint256 indexed roundId, address indexed by, uint64 until);
    event DisputeResolved(uint256 indexed roundId);
    event Refunded(address indexed member, uint256 amount);
    event StudyCreated(address[6] roster, uint64 depositDeadline);
    event RoundOpened(uint256 indexed roundId, uint64 submitDeadline, uint64 attestDeadline);
    event MemberLeft(address indexed member, uint8 fromRound);
    event ProposalCreated(
        uint256 indexed proposalId, ProposalType proposalType, address indexed proposer, address indexed target
    );
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support);
    event ProposalExecuted(uint256 indexed proposalId);
    event WalletReplaced(address indexed oldWallet, address indexed newWallet);
    event StudyFinalized(uint256 leftover, uint256 perfectCount);

    error ZeroAddress();
    error StudyAlreadyCreated();
    error DuplicateMember();
    error NotMember();
    error InvalidStatus();
    error DepositWindowClosed();
    error AlreadyDeposited();
    error DepositWindowOpen();
    error RoundNotOpen();
    error RoundNotSettled();
    error AlreadySettled();
    error InvalidDeadline();
    error AllRoundsOpened();
    error AlreadySubmitted();
    error EmptyProof();
    error SubmissionClosed();
    error MemberLeftStudy();
    error SelfAttest();
    error ProofMissing();
    error FraudMarked();
    error AlreadyAttested();
    error AttestWindowClosed();
    error TooEarly();
    error DisputeExists();
    error NothingToWithdraw();
    error AlreadyFinalized();
    error ProposalMissing();
    error VotingOpen();
    error VotingClosed();
    error ProposalNotPassed();
    error AlreadyExecuted();
    error AlreadyVoted();
    error NotEligibleVoter();
    error InvalidProposal();
    error NothingRemaining();

    modifier onlyMember() {
        _index(msg.sender);
        _;
    }

    constructor(IERC20 token_, StudyAttendanceSBT sbt_) {
        if (address(token_) == address(0) || address(sbt_) == address(0)) revert ZeroAddress();
        token = token_;
        sbt = sbt_;
    }

    /// @notice 스터디원 6명을 등록하고 72시간 예치 기한을 연다.
    function createStudy(address[6] calldata roster) external {
        if (status != Status.None) revert StudyAlreadyCreated();

        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            address account = roster[i];
            if (account == address(0)) revert ZeroAddress();
            if (memberIndexPlusOne[account] != 0) revert DuplicateMember();
            members[i] = account;
            memberIndexPlusOne[account] = i + 1;
        }

        status = Status.Created;
        createdAt = uint64(block.timestamp);
        depositDeadline = createdAt + uint64(DEPOSIT_WINDOW);
        emit StudyCreated(roster, depositDeadline);
    }

    /// @notice 35,000 SDT를 예치한다. 기한 내 6명이 모두 예치하면 스터디가 시작된다.
    function deposit() external nonReentrant onlyMember {
        if (status != Status.Created) revert InvalidStatus();
        if (block.timestamp > depositDeadline) revert DepositWindowClosed();

        uint8 idx = _index(msg.sender);
        if (deposited[idx]) revert AlreadyDeposited();

        deposited[idx] = true;
        depositedCount += 1;
        if (depositedCount == MEMBER_COUNT) status = Status.Active;

        token.safeTransferFrom(msg.sender, address(this), DEPOSIT_AMOUNT);
        emit Deposited(msg.sender, DEPOSIT_AMOUNT);
    }

    /// @notice 72시간 내 전원 예치에 실패하면 이미 넣은 보증금을 전액 돌려주고 스터디를 취소한다.
    function cancelStudy() external nonReentrant {
        if (status != Status.Created) revert InvalidStatus();
        if (block.timestamp <= depositDeadline) revert DepositWindowOpen();

        status = Status.Cancelled;
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            if (!deposited[i]) continue;
            deposited[i] = false;
            token.safeTransfer(members[i], DEPOSIT_AMOUNT);
            emit Refunded(members[i], DEPOSIT_AMOUNT);
        }
        depositedCount = 0;
    }

    /**
     * @notice 중도 탈퇴. 열린 미정산 회차가 있으면 그 회차부터, 없으면 다음 회차부터 결석이다.
     * @dev 남은 회차 몫은 각 회차 정산에서 결석분으로 정시 출석자에게 나뉜다.
     */
    function leaveStudy() external onlyMember {
        if (status != Status.Active) revert InvalidStatus();
        uint8 idx = _index(msg.sender);
        if (leftSeat[idx]) revert MemberLeftStudy();

        uint8 fromRound = currentRound == 0 || rounds[currentRound].settled ? currentRound + 1 : currentRound;
        if (fromRound == 0 || fromRound > TOTAL_ROUNDS) revert NothingRemaining();

        leftSeat[idx] = true;
        leftFromRound[idx] = fromRound;
        emit MemberLeft(msg.sender, fromRound);
    }

    /**
     * @notice 다음 회차를 연다.
     * @param submitDeadline 제출 마감. 일요일 23:59 타임스탬프.
     * @param attestDeadline 확인 마감. 화요일 23:59 타임스탬프.
     */
    function openRound(uint64 submitDeadline, uint64 attestDeadline) external onlyMember {
        if (status != Status.Active) revert InvalidStatus();
        if (currentRound == TOTAL_ROUNDS) revert AllRoundsOpened();
        if (currentRound > 0 && !rounds[currentRound].settled) revert RoundNotSettled();
        if (submitDeadline <= block.timestamp) revert InvalidDeadline();
        if (attestDeadline <= submitDeadline) revert InvalidDeadline();

        uint8 roundId = currentRound + 1;
        currentRound = roundId;
        Round storage round_ = rounds[roundId];
        round_.opened = true;
        round_.submitDeadline = submitDeadline;
        round_.attestDeadline = attestDeadline;
        emit RoundOpened(roundId, submitDeadline, attestDeadline);
    }

    /// @notice 현재 회차 진도 이미지의 해시만 제출한다. 마감 후 24시간까지는 지각이다.
    function submitProof(bytes32 proofHash) external onlyMember {
        uint8 idx = _index(msg.sender);
        uint8 roundId = currentRound;
        Round storage round_ = rounds[roundId];
        if (!round_.opened || round_.settled) revert RoundNotOpen();
        if (_hasLeft(idx, roundId)) revert MemberLeftStudy();
        if (round_.submitted[idx]) revert AlreadySubmitted();
        if (proofHash == bytes32(0)) revert EmptyProof();
        if (block.timestamp > uint256(round_.submitDeadline) + LATE_GRACE) revert SubmissionClosed();

        bool late = block.timestamp > round_.submitDeadline;
        round_.submitted[idx] = true;
        round_.late[idx] = late;
        round_.submittedAt[idx] = uint64(block.timestamp);
        round_.proofHashes[idx] = proofHash;
        emit ProofSubmitted(roundId, msg.sender, proofHash, late);
    }

    /// @notice 다른 스터디원의 증빙을 확인한다. 본인 확인은 거절된다.
    function attest(address member) external onlyMember {
        uint8 attester = _index(msg.sender);
        uint8 subject = _index(member);
        if (attester == subject) revert SelfAttest();

        uint8 roundId = currentRound;
        Round storage round_ = rounds[roundId];
        if (!round_.submitted[subject]) revert ProofMissing();
        if (round_.fraud[subject]) revert FraudMarked();
        if (round_.settled) revert AlreadySettled();
        if (hasAttested[roundId][attester][subject]) revert AlreadyAttested();
        if (block.timestamp > _attestClose(round_, subject)) revert AttestWindowClosed();

        hasAttested[roundId][attester][subject] = true;
        round_.attestCount[subject] += 1;
        round_.attestsGiven[attester] += 1;
        totalAttestsGiven[attester] += 1;
        emit Attested(roundId, msg.sender, member);
    }

    /// @notice 확인 마감과 분쟁 보류가 지난 뒤, 현재 회차를 한 번만 정산한다. 토큰은 보내지 않는다.
    function settleRound() external nonReentrant {
        uint8 roundId = currentRound;
        Round storage round_ = rounds[roundId];
        if (!round_.opened || round_.settled) revert RoundNotOpen();
        if (block.timestamp <= settlementReadyAt(roundId)) revert TooEarly();

        (uint8 recipients, uint256 share, uint256 distributedPot) = _accountRound(roundId);
        round_.distributed = distributedPot;
        round_.settled = true;
        round_.settledAt = uint64(block.timestamp);

        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            uint8 kind = _classify(roundId, i);
            uint256 payout = _basePayout(kind, round_.attesterPenalized[i]);
            if (kind == ON_TIME && !round_.attesterPenalized[i] && recipients > 0) payout += share;
            if (payout > 0) {
                _credit(i, payout);
                roundPayout[roundId][i] = payout;
                emit Distributed(roundId, members[i], payout);
            }
            if (kind == ON_TIME || kind == LATE) {
                attended[roundId][i] = true;
                badgeId[roundId][i] = sbt.mint(members[i], roundId, round_.attestsGiven[i]);
            }
        }

        if (round_.disputeOpen) {
            round_.disputeOpen = false;
            emit DisputeResolved(roundId);
        }
        emit RoundSettled(roundId, round_.onTimeCount, round_.lateCount, round_.absentCount, distributedPot);
    }

    /// @notice 본인 좌석에 쌓인 환급금과 분배금을 인출한다.
    function withdraw() external nonReentrant onlyMember {
        uint8 idx = _index(msg.sender);
        uint256 amount = claimable[idx];
        if (amount == 0) revert NothingToWithdraw();

        claimable[idx] = 0;
        totalClaimable -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Refunded(msg.sender, amount);
    }

    /// @notice 7회차 정산 1주 뒤 잔액을 개근자(없으면 전원)에게 나누고, 개근자에게 배지를 발행한다.
    function finalizeStudy() external nonReentrant {
        if (finalized) revert AlreadyFinalized();
        if (status != Status.Active) revert InvalidStatus();
        Round storage last = rounds[TOTAL_ROUNDS];
        if (!last.settled) revert RoundNotSettled();
        if (block.timestamp < uint256(last.settledAt) + FINALIZE_DELAY) revert TooEarly();

        finalized = true;
        status = Status.Finalized;

        uint256 balance = token.balanceOf(address(this));
        uint256 leftover = balance > totalClaimable ? balance - totalClaimable : 0;
        uint8 perfectCount = _perfectCount();
        uint8 recipients = perfectCount == 0 ? MEMBER_COUNT : perfectCount;
        uint256 share = leftover / recipients;
        uint256 remainder = leftover % recipients;
        uint8 cursor;

        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            bool perfect = _isPerfect(i);
            if (perfect) perfectBadge[i] = sbt.mint(members[i], PERFECT_ROUND, totalAttestsGiven[i]);
            if (perfectCount > 0 && !perfect) continue;
            uint256 amount = share;
            if (cursor < remainder) amount += 1;
            cursor += 1;
            if (amount == 0) continue;
            _credit(i, amount);
            emit Distributed(TOTAL_ROUNDS, members[i], amount);
        }
        emit StudyFinalized(leftover, perfectCount);
    }

    /// @notice 확인 마감 전 이의 제기. 정산은 확인 마감 시각으로부터 24시간 보류된다.
    function raiseDispute() external onlyMember {
        uint8 roundId = currentRound;
        Round storage round_ = rounds[roundId];
        if (!round_.opened || round_.settled) revert RoundNotOpen();
        if (block.timestamp > round_.attestDeadline) revert AttestWindowClosed();
        if (round_.disputeOpen) revert DisputeExists();

        round_.disputeOpen = true;
        round_.disputeUntil = round_.attestDeadline + uint64(DISPUTE_DELAY);
        emit DisputeOpened(roundId, msg.sender, round_.disputeUntil);
    }

    /**
     * @notice 1인 1표, 24시간 투표 안건을 등록한다.
     * @param proposalType 공결, 허위 증빙, 지갑 교체.
     * @param target 신청자, 허위 제출자, 또는 바꿀 기존 지갑.
     * @param newWallet 지갑 교체일 때만 사용. 그 외에는 0 주소.
     * @param roundId 공결·허위 증빙 회차. 지갑 교체는 0.
     */
    function propose(ProposalType proposalType, address target, address newWallet, uint8 roundId)
        external
        onlyMember
        returns (uint256 proposalId)
    {
        uint8 proposerIndex = _index(msg.sender);
        uint8 targetIndex = _index(target);
        _validateProposal(proposalType, targetIndex, newWallet, roundId);

        proposalId = ++proposalCount;
        Proposal storage proposal_ = proposals[proposalId];
        proposal_.proposalType = proposalType;
        proposal_.proposerIndex = proposerIndex;
        proposal_.targetIndex = targetIndex;
        proposal_.newWallet = newWallet;
        proposal_.roundId = roundId;
        proposal_.deadline = uint64(block.timestamp + VOTING_PERIOD);
        proposal_.exists = true;
        emit ProposalCreated(proposalId, proposalType, msg.sender, target);
    }

    /// @notice 좌석당 한 표. 공결은 신청자, 허위 증빙은 당사자를 제외한다.
    function vote(uint256 proposalId, bool support) external onlyMember {
        Proposal storage proposal_ = proposals[proposalId];
        if (!proposal_.exists) revert ProposalMissing();
        if (proposal_.executed) revert AlreadyExecuted();
        if (block.timestamp >= proposal_.deadline) revert VotingClosed();

        uint8 voter = _index(msg.sender);
        if (voted[proposalId][voter]) revert AlreadyVoted();
        if (!_canVote(proposal_, voter)) revert NotEligibleVoter();

        voted[proposalId][voter] = true;
        if (support) proposal_.yesVotes += 1;
        else proposal_.noVotes += 1;
        emit VoteCast(proposalId, msg.sender, support);
    }

    /**
     * @notice 24시간 투표가 끝난 뒤 정족수를 넘은 안건을 실행한다.
     * @dev 공결은 신청자 제외 과반(3/5), 허위 증빙도 당사자 제외 과반(3/5), 지갑 교체는 2/3(4/6).
     */
    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage proposal_ = proposals[proposalId];
        if (!proposal_.exists) revert ProposalMissing();
        if (proposal_.executed) revert AlreadyExecuted();
        if (block.timestamp < proposal_.deadline) revert VotingOpen();
        if (!_passed(proposal_)) revert ProposalNotPassed();

        proposal_.executed = true;
        if (proposal_.proposalType == ProposalType.ExcusedAbsence) _executeExcused(proposal_);
        else if (proposal_.proposalType == ProposalType.FalseProof) _executeFalseProof(proposal_);
        else _executeWalletReplace(proposal_);
        emit ProposalExecuted(proposalId);
    }

    function getMembers() external view returns (address[6] memory) {
        return members;
    }

    function getStudyOverview() external view returns (StudyOverview memory overview) {
        overview.status = status;
        overview.memberAccounts = members;
        overview.createdAt = createdAt;
        overview.depositDeadline = depositDeadline;
        overview.currentRound = currentRound;
        overview.carryOver = carryOver;
        overview.escrowBalance = address(token) == address(0) ? 0 : token.balanceOf(address(this));
        overview.outstandingClaims = totalClaimable;
        overview.isFinalized = finalized;
        overview.attendanceSbt = address(sbt);
        overview.depositToken = address(token);
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            overview.depositedFlags[i] = deposited[i];
            overview.hasLeft[i] = leftSeat[i];
            overview.leaveFromRound[i] = leftFromRound[i];
        }
    }

    function getRound(uint8 roundId) external view returns (RoundView memory view_) {
        Round storage round_ = rounds[roundId];
        view_.submitDeadline = round_.submitDeadline;
        view_.attestDeadline = round_.attestDeadline;
        view_.disputeUntil = round_.disputeUntil;
        view_.settledAt = round_.settledAt;
        view_.opened = round_.opened;
        view_.settled = round_.settled;
        view_.disputeOpen = round_.disputeOpen;
        view_.onTimeCount = round_.onTimeCount;
        view_.lateCount = round_.lateCount;
        view_.absentCount = round_.absentCount;
        view_.distributed = round_.distributed;
        view_.proofHashes = round_.proofHashes;
        view_.submittedAt = round_.submittedAt;
        view_.submitted = round_.submitted;
        view_.late = round_.late;
        view_.excused = round_.excused;
        view_.fraud = round_.fraud;
        view_.attesterPenalized = round_.attesterPenalized;
        view_.attestCount = round_.attestCount;
        view_.attestsGiven = round_.attestsGiven;
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            view_.attendedRound[i] = attended[roundId][i];
        }
    }

    function getSubmission(uint8 roundId, address member) external view returns (SubmissionView memory view_) {
        uint8 idx = _index(member);
        Round storage round_ = rounds[roundId];
        view_.submitted = round_.submitted[idx];
        view_.late = round_.late[idx];
        view_.excused = round_.excused[idx];
        view_.fraud = round_.fraud[idx];
        view_.proofHash = round_.proofHashes[idx];
        view_.submittedAt = round_.submittedAt[idx];
        view_.attestCount = round_.attestCount[idx];
        view_.attestsGiven = round_.attestsGiven[idx];
        view_.roundPayout = roundPayout[roundId][idx];
        view_.badgeTokenId = badgeId[roundId][idx];
        if (round_.settled) view_.recognized = attended[roundId][idx];
        else if (round_.opened) {
            uint8 kind = _classify(roundId, idx);
            view_.recognized = kind == ON_TIME || kind == LATE;
        }
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            view_.attestedBySeat[i] = hasAttested[roundId][i][idx];
        }
    }

    /// @notice 가스 없이 읽는 인출 가능 금액. 스터디원이 아니면 0.
    function withdrawableOf(address account) external view returns (uint256) {
        uint8 indexPlusOne = memberIndexPlusOne[account];
        if (indexPlusOne == 0) return 0;
        return claimable[indexPlusOne - 1];
    }

    /// @notice 정산 가능 시각. 확인 마감, 지각분의 48시간 확인 창, 분쟁 보류 중 가장 늦은 시각.
    function settlementReadyAt(uint8 roundId) public view returns (uint256 readyAt) {
        Round storage round_ = rounds[roundId];
        readyAt = round_.attestDeadline;
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            if (!round_.submitted[i] || !round_.late[i]) continue;
            uint256 closeAt = uint256(round_.submittedAt[i]) + ATTEST_WINDOW;
            if (closeAt > readyAt) readyAt = closeAt;
        }
        if (round_.disputeUntil > readyAt) readyAt = round_.disputeUntil;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function previewRecognition(uint8 roundId, address member)
        external
        view
        returns (bool recognized, bool late, uint8 attestations)
    {
        uint8 idx = _index(member);
        Round storage round_ = rounds[roundId];
        attestations = round_.attestCount[idx];
        late = round_.late[idx];
        if (!round_.opened) return (false, late, attestations);
        if (round_.settled) return (attended[roundId][idx], late, attestations);
        uint8 kind = _classify(roundId, idx);
        return (kind == ON_TIME || kind == LATE, late, attestations);
    }

    function _accountRound(uint8 roundId) internal returns (uint8 recipients, uint256 share, uint256 distributedPot) {
        Round storage round_ = rounds[roundId];
        uint256 pot = carryOver;
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            uint8 kind = _classify(roundId, i);
            bool penalized = round_.attesterPenalized[i];
            if (kind == ON_TIME) {
                round_.onTimeCount += 1;
                if (!penalized) recipients += 1;
            } else if (kind == LATE) {
                round_.lateCount += 1;
            } else {
                round_.absentCount += 1;
            }
            pot += _forfeit(kind, penalized);
        }
        if (recipients == 0) {
            carryOver = pot;
            return (0, 0, 0);
        }
        share = pot / recipients;
        carryOver = pot % recipients;
        distributedPot = pot - carryOver;
    }

    function _validateProposal(ProposalType proposalType, uint8 targetIndex, address newWallet, uint8 roundId)
        internal
        view
    {
        if (proposalType == ProposalType.WalletReplace) {
            if (newWallet == address(0)) revert ZeroAddress();
            if (memberIndexPlusOne[newWallet] != 0) revert DuplicateMember();
            if (roundId != 0) revert InvalidProposal();
            return;
        }
        if (roundId == 0 || roundId > TOTAL_ROUNDS) revert InvalidProposal();
        Round storage round_ = rounds[roundId];
        if (!round_.opened || round_.settled) revert RoundNotOpen();
        if (newWallet != address(0)) revert InvalidProposal();
        if (proposalType == ProposalType.FalseProof) {
            if (!round_.submitted[targetIndex]) revert ProofMissing();
            if (round_.fraud[targetIndex]) revert FraudMarked();
        }
    }

    function _canVote(Proposal storage proposal_, uint8 voter) internal view returns (bool) {
        if (proposal_.proposalType == ProposalType.WalletReplace) return true;
        return voter != proposal_.targetIndex;
    }

    function _passed(Proposal storage proposal_) internal view returns (bool) {
        if (proposal_.proposalType == ProposalType.WalletReplace) return proposal_.yesVotes >= WALLET_YES;
        if (proposal_.proposalType == ProposalType.ExcusedAbsence) return proposal_.yesVotes >= EXCUSED_YES;
        return proposal_.yesVotes >= FALSE_PROOF_YES;
    }

    function _executeExcused(Proposal storage proposal_) internal {
        Round storage round_ = rounds[proposal_.roundId];
        if (!round_.opened || round_.settled) revert RoundNotOpen();
        round_.excused[proposal_.targetIndex] = true;
    }

    function _executeFalseProof(Proposal storage proposal_) internal {
        uint8 roundId = proposal_.roundId;
        uint8 target = proposal_.targetIndex;
        Round storage round_ = rounds[roundId];
        if (round_.fraud[target]) revert FraudMarked();
        round_.fraud[target] = true;

        bool[6] memory newlyPenalized;
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            if (!hasAttested[roundId][i][target] || round_.attesterPenalized[i]) continue;
            newlyPenalized[i] = true;
            round_.attesterPenalized[i] = true;
        }

        if (!round_.settled) {
            if (round_.disputeOpen) {
                round_.disputeOpen = false;
                emit DisputeResolved(roundId);
            }
            return;
        }

        uint256 seized = _slash(roundId, target, roundPayout[roundId][target]);
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            if (!newlyPenalized[i]) continue;
            uint256 penalty = HALF_SHARE;
            if (penalty > roundPayout[roundId][i]) penalty = roundPayout[roundId][i];
            seized += _slash(roundId, i, penalty);
        }

        _burnBadge(badgeId[roundId][target]);
        badgeId[roundId][target] = 0;
        attended[roundId][target] = false;
        _redistribute(roundId, seized);
        if (round_.disputeOpen) round_.disputeOpen = false;
        emit DisputeResolved(roundId);
    }

    function _executeWalletReplace(Proposal storage proposal_) internal {
        address newWallet = proposal_.newWallet;
        if (newWallet == address(0)) revert ZeroAddress();
        if (memberIndexPlusOne[newWallet] != 0) revert DuplicateMember();

        uint8 idx = proposal_.targetIndex;
        address oldWallet = members[idx];
        memberIndexPlusOne[oldWallet] = 0;
        members[idx] = newWallet;
        memberIndexPlusOne[newWallet] = idx + 1;

        for (uint8 roundId = 1; roundId <= TOTAL_ROUNDS; ++roundId) {
            uint256 tokenId = badgeId[roundId][idx];
            if (tokenId != 0) sbt.reassign(tokenId, newWallet);
        }
        if (perfectBadge[idx] != 0) sbt.reassign(perfectBadge[idx], newWallet);
        emit WalletReplaced(oldWallet, newWallet);
    }

    function _classify(uint8 roundId, uint8 idx) internal view returns (uint8) {
        Round storage round_ = rounds[roundId];
        if (round_.fraud[idx] || _hasLeft(idx, roundId)) return ABSENT;
        if (round_.excused[idx]) return ON_TIME;
        if (!round_.submitted[idx] || round_.attestCount[idx] < ATTEST_THRESHOLD) return ABSENT;
        if (round_.late[idx]) return LATE;
        return ON_TIME;
    }

    function _forfeit(uint8 kind, bool penalized) internal pure returns (uint256) {
        if (kind == ABSENT) return ROUND_SHARE;
        if (kind == LATE) return penalized ? ROUND_SHARE : HALF_SHARE;
        return penalized ? HALF_SHARE : 0;
    }

    function _basePayout(uint8 kind, bool penalized) internal pure returns (uint256) {
        if (kind == ON_TIME) return penalized ? HALF_SHARE : ROUND_SHARE;
        if (kind == LATE) return penalized ? 0 : HALF_SHARE;
        return 0;
    }

    /// @dev 정시 제출은 min(제출+48시간, 확인 마감), 지각 제출은 제출+48시간.
    function _attestClose(Round storage round_, uint8 subject) internal view returns (uint256 closeAt) {
        closeAt = uint256(round_.submittedAt[subject]) + ATTEST_WINDOW;
        if (!round_.late[subject] && uint256(round_.attestDeadline) < closeAt) closeAt = round_.attestDeadline;
    }

    function _hasLeft(uint8 idx, uint8 roundId) internal view returns (bool) {
        return leftSeat[idx] && leftFromRound[idx] != 0 && roundId >= leftFromRound[idx];
    }

    function _isPerfect(uint8 idx) internal view returns (bool) {
        if (leftSeat[idx]) return false;
        for (uint8 roundId = 1; roundId <= TOTAL_ROUNDS; ++roundId) {
            if (!attended[roundId][idx]) return false;
        }
        return true;
    }

    function _perfectCount() internal view returns (uint8 count) {
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            if (_isPerfect(i)) count += 1;
        }
    }

    function _credit(uint8 idx, uint256 amount) internal {
        claimable[idx] += amount;
        totalClaimable += amount;
    }

    function _slash(uint8 roundId, uint8 idx, uint256 amount) internal returns (uint256 seized) {
        if (amount == 0) return 0;
        uint256 available = claimable[idx];
        seized = amount <= available ? amount : available;
        claimable[idx] -= seized;
        totalClaimable -= seized;
        if (seized >= roundPayout[roundId][idx]) roundPayout[roundId][idx] = 0;
        else roundPayout[roundId][idx] -= seized;
    }

    function _redistribute(uint8 roundId, uint256 seized) internal {
        if (seized == 0) return;
        uint8 recipients;
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            if (_keepsHonestShare(roundId, i)) recipients += 1;
        }
        if (recipients == 0) {
            carryOver += seized;
            return;
        }
        uint256 share = seized / recipients;
        uint256 remainder = seized % recipients;
        uint8 cursor;
        for (uint8 i = 0; i < MEMBER_COUNT; ++i) {
            if (!_keepsHonestShare(roundId, i)) continue;
            uint256 amount = share;
            if (cursor < remainder) amount += 1;
            cursor += 1;
            if (amount == 0) continue;
            _credit(i, amount);
            emit Distributed(roundId, members[i], amount);
        }
    }

    function _keepsHonestShare(uint8 roundId, uint8 idx) internal view returns (bool) {
        Round storage round_ = rounds[roundId];
        return attended[roundId][idx] && !round_.late[idx] && !round_.fraud[idx] && !round_.attesterPenalized[idx];
    }

    function _burnBadge(uint256 tokenId) internal {
        if (tokenId != 0) sbt.burn(tokenId);
    }

    function _index(address account) internal view returns (uint8) {
        uint8 indexPlusOne = memberIndexPlusOne[account];
        if (indexPlusOne == 0) revert NotMember();
        return indexPlusOne - 1;
    }
}
