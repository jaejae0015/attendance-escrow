// Sepolia 테스트넷에 배포된 StudyDepositToken, StudyAttendanceSBT, StudyEscrow.
// 스터디원 명단은 체인에 없고, createStudy로 등록한다.
window.APP_CONFIG = {
  "network": "sepolia",
  "chainId": 11155111,
  "readRpcs": [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://1rpc.io/sepolia",
    "https://sepolia.drpc.org"
  ],
  "sdt": "0x77088516e1F406a4b05088f00061ffb2654190AD",
  "sbt": "0x2E293185aca06Ee286C067781F0111859FBE2C08",
  "escrow": "0xd0151E9FD1cdE12f88AFb738D35D780e018bd55f",
  "config": {
    "perRound": "5000000000000000000000",
    "depositAmount": "35000000000000000000000",
    "rounds": 7,
    "threshold": 3,
    "depositWindow": 259200,
    "lateWindow": 86400,
    "attestWindow": 172800,
    "votingPeriod": 86400,
    "finalizeDelay": 604800
  }
};
