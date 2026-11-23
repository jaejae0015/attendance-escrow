// 세폴리아에 배포된 StudyDepositToken / StudyAttendanceSBT / StudyEscrow 화면.
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || null;
  const ABI = window.APP_ABI || null;
  const LOCAL_CHAIN = 31337;
  const SEPOLIA = 11155111;
  const ST_NONE = 0, ST_CREATED = 1, ST_ACTIVE = 2, ST_CANCELLED = 3, ST_FINAL = 4;
  const KIND_ABSENT = 0, KIND_ON_TIME = 1, KIND_LATE = 2;
  const LOG_CHUNK = 4000;
  const LOG_LOOKBACK = 150000;
  const SEPOLIA_HEX = "0xaa36a7";
  const READ_RPCS = (CFG && Array.isArray(CFG.readRpcs) && CFG.readRpcs.length)
    ? CFG.readRpcs
    : ["https://ethereum-sepolia-rpc.publicnode.com", "https://1rpc.io/sepolia", "https://sepolia.drpc.org"];
  const POLL_MS = 15000;
  const MODULES = ["", "Blockchain Cryptography", "Blockchain Storage", "Ethereum State Machine", "Smart Contract Basics", "Solidity Language", "Solidity Core", "Solidity Governance"];
  const ATT = ["대기", "출석", "지각", "결석", "공결"];
  const ATT_CLS = ["mute", "ok", "warn", "warn", "blue"];
  const PROP = ["공결", "허위 증빙", "지갑 교체"];
  const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const TABS = ["home", "deposit", "proof", "attest", "settle", "excuse", "log"];
  const COIN_EVENTS = new Set(["Transfer", "Deposited", "Distributed", "Refunded"]);
  const ERR_KO = {
    NotMember: "등록된 스터디원 지갑이 아니에요",
    InvalidStatus: "지금 상태에서는 할 수 없는 동작이에요",
    AlreadyDeposited: "이미 예치했어요",
    DepositWindowClosed: "예치 기한이 지났어요",
    DepositWindowOpen: "아직 예치 기한이 남아 있어요",
    RoundNotOpen: "열린 회차가 없거나 이미 정산됐어요",
    RoundNotSettled: "이전 회차를 먼저 정산해야 해요",
    AllRoundsOpened: "모든 회차가 이미 열렸어요",
    AlreadySubmitted: "이번 회차 증빙을 이미 제출했어요",
    SubmissionClosed: "증빙 제출 기간이 끝났어요",
    EmptyProof: "해시가 비어 있어요",
    SelfAttest: "내 증빙은 내가 확인할 수 없어요",
    ProofMissing: "아직 증빙을 제출하지 않은 스터디원이에요",
    AlreadyAttested: "이미 확인했어요",
    AttestWindowClosed: "확인 기간이 끝났어요",
    TooEarly: "아직 정산하거나 종료할 수 있는 시각이 아니에요",
    AlreadySettled: "이미 정산된 회차예요",
    InvalidDeadline: "마감 시각이 잘못됐어요. 제출 마감은 현재보다 뒤, 확인 마감은 제출 마감보다 뒤여야 해요",
    NothingToWithdraw: "인출할 금액이 없어요",
    AlreadyFinalized: "이미 최종 정산됐어요",
    StudyAlreadyCreated: "이미 스터디가 등록돼 있어요",
    DuplicateMember: "같은 지갑이 두 번 들어 있어요",
    ZeroAddress: "주소가 비어 있어요",
    MemberLeftStudy: "이 회차에 참여하지 않는 스터디원이에요",
    FraudMarked: "허위 증빙으로 처리된 건이에요",
    DisputeExists: "이미 이의가 제기돼 있어요",
    NothingRemaining: "더 남긴 회차가 없어요",
    ProposalMissing: "없는 안건이에요",
    VotingOpen: "투표가 끝나기 전에는 실행할 수 없어요",
    VotingClosed: "투표 기간이 끝났어요",
    ProposalNotPassed: "찬성 표가 기준에 못 미쳐요",
    AlreadyExecuted: "이미 실행된 안건이에요",
    AlreadyVoted: "이미 투표했어요",
    NotEligibleVoter: "이 안건에는 투표할 수 없어요",
    InvalidProposal: "안건 내용이 조건에 맞지 않아요",
    ERC20InsufficientAllowance: "SDT 사용 승인이 부족해요. 다시 눌러 승인부터 진행해 주세요",
    ERC20InsufficientBalance: "SDT 잔액이 부족해요. 테스트 SDT를 먼저 받아 주세요",
    OnlyEscrow: "에스크로 컨트랙트만 할 수 있어요",
    OnlyOwner: "SBT 배포자만 할 수 있어요",
    SoulboundTokenLocked: "출석 배지는 양도할 수 없어요",
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (v) => Number(ethers.formatUnits(v, 18)).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "-";
  const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const ts = (t) => {
    if (!t) return "-";
    const d = new Date(Number(t) * 1000);
    return `${d.getMonth() + 1}/${d.getDate()} (${DAYS[d.getDay()]}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const remain = (deadline, now) => {
    const d = Number(deadline) - now;
    if (d <= 0) return "마감 지남";
    const h = Math.floor(d / 3600), m = Math.floor((d % 3600) / 60);
    return h >= 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간 남음` : h > 0 ? `${h}시간 ${m}분 남음` : `${m}분 남음`;
  };
  const nm = (i) => "스터디원 " + String.fromCharCode(65 + i);
  const nameOf = (members, a) => { const i = (members || []).findIndex(x => same(x, a)); return i >= 0 ? nm(i) : short(a); };
  const av = (i, dim) => `<span class="av av${(i < 0 ? 7 : i) % 8}${dim ? " dim" : ""}" aria-hidden="true">${String.fromCharCode(65 + (i < 0 ? 7 : i))}</span>`;
  const emptyRow = (t) => `<li class="li empty-row">${t}</li>`;
  const sha256File = async (file) => {
    const h = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return "0x" + Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
  };
  const explorer = (kind, v) => CFG?.chainId === SEPOLIA ? `https://sepolia.etherscan.io/${kind}/${v}` : null;
  const txHref = (hash) => /^0x[0-9a-fA-F]{64}$/.test(hash || "") ? explorer("tx", hash) : null;
  const localInput = (unix) => {
    const d = new Date(Number(unix) * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const unixFromLocal = (id) => {
    const v = $(id)?.value;
    if (!v) return 0;
    const n = Math.floor(new Date(v).getTime() / 1000);
    return Number.isFinite(n) ? n : 0;
  };

  const isLocalPage = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);
  const chainIsLocal = CFG?.chainId === LOCAL_CHAIN;
  const canDemo = !!CFG && !!ABI && isLocalPage && chainIsLocal;
  const canWallet = !!CFG && !!ABI && (!chainIsLocal || isLocalPage);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  let provider, signer, me, escrow, sdt, sbt, escrowRead, sdtRead, sbtRead, ifaceAll, chainParams;
  let readRunner = null, publicProviders = null, switchingChain = false, skipWalletReads = false;
  let demo = false, timer = null, connected = false, listening = false;
  let S = {};
  const SCENARIOS = ["deposit", "proof", "attest", "ready", "settled", "finished"];
  const scParam = new URLSearchParams(location.search).get("sc");
  let scenario = SCENARIOS.includes(scParam) ? scParam : "attest";
  let logs = [], logsTo = null, logsPartial = false;
  let pendingHash = null, pendingFile = null, pendingAt = null;
  let verifyTarget = null, verified = {};
  let refreshSeq = 0, busy = false;
  const steps = { s1: false, s2: false };
  const actions = {};

  function fallbackCfg() {
    const c = CFG?.config || {};
    const per = BigInt(c.perRound || "5000000000000000000000");
    return {
      perRound: per,
      rounds: Number(c.rounds || 7),
      threshold: Number(c.threshold || 3),
      depositWindow: Number(c.depositWindow || 259200),
      lateWindow: Number(c.lateWindow || 86400),
      attestWindow: Number(c.attestWindow || 172800),
      depositAmount: BigInt(c.depositAmount || (per * 7n)),
      votingPeriod: Number(c.votingPeriod || 86400),
      finalizeDelay: Number(c.finalizeDelay || 604800),
      half: per / 2n,
    };
  }

  function kindOf(rd, i, roundId, hasLeft, leaveFrom, threshold) {
    if (rd.fraud[i] || (hasLeft[i] && leaveFrom[i] && roundId >= leaveFrom[i])) return KIND_ABSENT;
    if (rd.excused[i]) return KIND_ON_TIME;
    if (!rd.submitted[i] || Number(rd.attestCount[i]) < threshold) return KIND_ABSENT;
    if (rd.late[i]) return KIND_LATE;
    return KIND_ON_TIME;
  }
  function statusOf(rd, i, kind) {
    if (rd.excused[i] && kind === KIND_ON_TIME) return 4;
    if (kind === KIND_ON_TIME) return 1;
    if (kind === KIND_LATE) return 2;
    return 3;
  }
  function basePayout(kind, penalized, per, half) {
    if (kind === KIND_ON_TIME) return penalized ? half : per;
    if (kind === KIND_LATE) return penalized ? 0n : half;
    return 0n;
  }
  function phaseOf(rd, now, lateWindow, readyAt) {
    if (!rd || !rd.opened) return 0;
    if (rd.settled) return 5;
    if (now > readyAt) return 4;
    if (now > Number(rd.submitDeadline) + lateWindow) return 3;
    if (now > Number(rd.submitDeadline)) return 2;
    return 1;
  }
  function attestClose(x, rd, windowSec) {
    let close = Number(x.proofAt) + windowSec;
    if (!x.late && Number(rd.attestDeadline) < close) close = Number(rd.attestDeadline);
    return close;
  }
  function aliasRound(rd, lateWindow) {
    if (!rd) return null;
    rd.proofDeadline = rd.submitDeadline;
    rd.lateDeadline = Number(rd.submitDeadline) + lateWindow;
    rd.pool = rd.distributed;
    rd.presentCount = rd.onTimeCount;
    return rd;
  }

  function sampleState(sc) {
    const hexFill = (seed, n) => ethers.id("sample-" + seed).slice(2, 2 + n);
    const E = 10n ** 18n, per = 5000n * E, rounds = 7, threshold = 3;
    const members = Array.from({ length: 6 }, (_, i) => "0x" + hexFill(i + 1, 40));
    const now = Math.floor(Date.now() / 1000);
    const cfg = fallbackCfg();
    cfg.perRound = per; cfg.rounds = rounds; cfg.threshold = threshold; cfg.half = per / 2n; cfg.depositAmount = per * 7n;
    const Z = ethers.ZeroHash;
    const mr = (i, has, att, late) => ({ proofHash: has ? "0x" + hexFill(i + 11, 64) : Z, late: !!late, attestCount: att, status: 0, proofAt: has ? now - 26 * 3600 - i * 1800 : 0, excused: false, fraud: false, penalized: false, submitted: has, kind: 0, payout: 0n });
    const mkHist = (round, statuses) => {
      const refundOf = (s) => s === 1 || s === 4 ? per : s === 2 ? per / 2n : 0n;
      const pool = statuses.reduce((acc, s) => acc + (per - refundOf(s)), 0n);
      const present = statuses.filter(s => s === 1 || s === 4).length;
      const share = present > 0 ? pool / BigInt(present) : 0n;
      const rows = statuses.map((s, i) => ({ addr: members[i], i, status: s, kind: s === 2 ? 2 : s === 3 ? 0 : 1, attestCount: s === 1 || s === 2 || s === 4 ? 3 : 0, excused: s === 4, fraud: false, penalized: false, refund: refundOf(s), share: s === 1 || s === 4 ? share : 0n, got: refundOf(s) + (s === 1 || s === 4 ? share : 0n), payout: refundOf(s) }));
      const count = [0, 0, 0, 0, 0]; rows.forEach(x => count[x.status]++);
      return { round, rd: { settled: true, pool, presentCount: BigInt(present), attestDeadline: now - 86400 }, rows, present, share, count, mine: rows[0] };
    };
    const ALL = [1, 1, 1, 1, 1, 1], ONE_ABSENT = [1, 1, 1, 1, 1, 3];
    const histOf = (n) => Array.from({ length: n }, (_, i) => mkHist(n - i, n - i === 3 || n - i === 4 ? ONE_ABSENT : ALL));
    const base = {
      members, cfg, rounds, threshold, now, myIdx: 0, isMember: true,
      sdtBal: 0n, allowance: 0n, depFlags: Array(6).fill(true), depCount: 6, myDep: true,
      total: per * BigInt(rounds), depDeadline: now - 30 * 86400, attestedByMe: [], myAttesters: [],
      carry: 0n, readyAt: now, proposals: [], hasLeft: Array(6).fill(false),
    };
    const withHist = (n) => {
      const hist = histOf(n), returned = hist.reduce((acc, h) => acc + h.mine.got, 0n);
      return { hist, returned, settledN: n, locked: per * BigInt(rounds - n), bal: returned, att: n, sbtBal: n };
    };
    const openRd = (p, a) => ({ settled: false, opened: true, proofDeadline: p, lateDeadline: p + 86400, attestDeadline: a, submitDeadline: p, pool: 0n, presentCount: 0n, disputeOpen: false });

    if (sc === "deposit") {
      return { ...base, st: ST_CREATED, r: 0, rd: null, phase: 0, hist: [], returned: 0n, settledN: 0, locked: 0n, bal: 0n, att: 0, sbtBal: 0, sdtBal: 100000n * E,
        depFlags: [false, true, true, true, true, false], depCount: 4, myDep: false, depDeadline: now + 2 * 86400 + 3600, mrs: [], mine: null, hasProof: false };
    }
    if (sc === "proof") {
      const mrs = [mr(0, false, 0), mr(1, true, 2), mr(2, true, 1), mr(3, true, 0), mr(4, false, 0), mr(5, false, 0)];
      return { ...base, ...withHist(3), st: ST_ACTIVE, r: 4, rd: openRd(now + 2 * 86400, now + 4 * 86400), phase: 1, mrs, mine: mrs[0], hasProof: false, attestedByMe: Array(6).fill(false), readyAt: now + 4 * 86400 };
    }
    if (sc === "ready") {
      const mrs = [mr(0, true, 3), mr(1, true, 3), mr(2, true, 3), mr(3, true, 4), mr(4, true, 3), mr(5, false, 0)];
      return { ...base, ...withHist(3), st: ST_ACTIVE, r: 4, rd: openRd(now - 2 * 86400, now - 3600), phase: 4, mrs, mine: mrs[0], hasProof: true,
        attestedByMe: [false, true, true, true, true, false], myAttesters: [members[1], members[3], members[4]], readyAt: now - 60 };
    }
    if (sc === "settled") {
      const mrs = [mr(0, true, 3), mr(1, true, 3), mr(2, true, 3), mr(3, true, 4), mr(4, true, 3), mr(5, false, 0)];
      const rd = openRd(now - 3 * 86400, now - 86400); rd.settled = true; rd.pool = per; rd.presentCount = 5n;
      return { ...base, ...withHist(4), st: ST_ACTIVE, r: 4, rd, phase: 5, mrs, mine: mrs[0], hasProof: true, attestedByMe: Array(6).fill(false) };
    }
    if (sc === "finished") {
      const rd = openRd(now - 3 * 86400, now - 86400); rd.settled = true; rd.pool = 0n; rd.presentCount = 6n;
      const mrs = Array.from({ length: 6 }, (_, i) => mr(i, true, 3));
      return { ...base, ...withHist(7), st: ST_FINAL, r: 7, rd, phase: 5, mrs, mine: mrs[0], hasProof: true, attestedByMe: Array(6).fill(false) };
    }
    const mrs = [mr(0, true, 2), mr(1, true, 3), mr(2, true, 1), mr(3, true, 3), mr(4, true, 2), mr(5, false, 0)];
    return { ...base, ...withHist(3), st: ST_ACTIVE, r: 4, rd: openRd(now - 20 * 3600, now + 31 * 3600), phase: 3, mrs, mine: mrs[0], hasProof: true,
      attestedByMe: [false, true, false, true, false, false], myAttesters: [members[1], members[3]], readyAt: now + 31 * 3600 };
  }

  function historyRow(title, detail, tx) {
    const href = txHref(tx);
    const link = href ? `<a class="txlink" href="${href}" target="_blank" rel="noopener noreferrer">이더스캔</a>` : "";
    return `<li class="li"><span class="who">${title}<small>${detail}</small></span>${link}</li>`;
  }
  function sampleLists() {
    const coin = [
      historyRow("예치", "스터디원 A · 35,000 SDT · 블록 7", null),
      historyRow("SDT 수령", "스터디원 A · 35,000 SDT · 블록 2", null),
      historyRow("정산 분배", "3회차 · 스터디원 A · +6,000 SDT · 블록 40", null),
      historyRow("환급·인출", "스터디원 A · 6,000 SDT · 블록 41", null),
    ].join("");
    const act = [
      historyRow("4회차 확인", "스터디원 D → 스터디원 A · 블록 48", null),
      historyRow("4회차 증빙", "스터디원 A · 블록 45", null),
      historyRow("4회차 시작", "블록 41", null),
      historyRow("3회차 정산", "정시 5명 · 분배 풀 5,000 SDT · 블록 40", null),
      historyRow("스터디 등록", "예치 마감이 열렸어요 · 블록 1", null),
    ].join("");
    $("coinHistory").innerHTML = coin;
    $("eventLog").innerHTML = act;
  }
  function enterSample() {
    S = sampleState(scenario);
    $("sampleBar").hidden = false;
    document.querySelectorAll("[data-sc]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sc === scenario)));
    $("sampleText").innerHTML = canWallet || canDemo
      ? "<strong>샘플 화면이에요.</strong> 지갑을 연결하면 세폴리아의 실제 기록이 보여요."
      : "<strong>샘플 화면이에요.</strong> 테스트넷 컨트랙트를 연결하기 전이라 실제 거래는 일어나지 않아요.";
    sampleLists();
    renderContracts();
    $("netLabel").textContent = !CFG ? "config.js가 없어요."
      : chainIsLocal ? "로컬 개발 체인 주소예요." : `${CFG.network} · chainId ${CFG.chainId} · 지갑을 연결하면 이 주소의 실제 기록을 읽어요`;
    renderAll();
  }

  let msgTimer = null;
  function msg(text, cls, link) {
    const el = $("msg");
    clearTimeout(msgTimer);
    el.className = "toast " + (cls || "");
    el.textContent = text;
    if (link) {
      const a = document.createElement("a");
      a.href = link; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = " 세폴리아 이더스캔에서 보기";
      el.appendChild(a);
    }
    el.hidden = false;
    if (cls !== "pending") msgTimer = setTimeout(() => { el.hidden = true; }, cls === "err" ? 12000 : 6000);
  }
  $("msg").addEventListener("click", (e) => { if (e.target.tagName !== "A") $("msg").hidden = true; });

  function explain(e) {
    const data = e?.data || e?.info?.error?.data || e?.error?.data;
    if (ifaceAll && typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      try { const p = ifaceAll.parseError(data); if (p) return ERR_KO[p.name] || p.name; } catch (_) { /* 알 수 없는 에러 데이터 */ }
    }
    if (e?.code === "ACTION_REJECTED" || e?.code === 4001 || e?.info?.error?.code === 4001) return "지갑에서 서명을 거부했어요";
    const m = e?.shortMessage || e?.reason || e?.message || String(e);
    if (/coalesce|failed to detect network/i.test(m)) return "지갑 네트워크 응답이 불안정해요. Sepolia로 바꾼 뒤 다시 연결해 주세요.";
    for (const k of Object.keys(ERR_KO)) if (m.includes(k)) return ERR_KO[k];
    return m.length > 200 ? m.slice(0, 200) + "…" : m;
  }

  async function tx(label, fn) {
    if (!connected) { msg("샘플 화면이라 실제로 처리되지는 않아요.", ""); return false; }
    if (busy) return false;
    busy = true; document.body.classList.add("busy");
    try {
      msg(label + " · 지갑에서 서명해 주세요", "pending");
      const t = await fn();
      msg(label + " · 블록에 기록되는 중이에요 " + short(t.hash), "pending", explorer("tx", t.hash));
      const r = await t.wait();
      msg(label + " 완료 (블록 " + r.blockNumber + ")", "ok", explorer("tx", t.hash));
      await refresh();
      return true;
    } catch (e) {
      console.error(e);
      msg(label + " 실패: " + explain(e), "err");
      return false;
    } finally {
      busy = false; document.body.classList.remove("busy");
    }
  }

  function setupRoster() {
    const wrap = $("rosterFields");
    if (!wrap || wrap.childElementCount) return;
    wrap.innerHTML = Array.from({ length: 6 }, (_, i) =>
      `<label>${nm(i)}<input id="roster${i}" type="text" autocomplete="off" spellcheck="false" placeholder="0x로 시작하는 지갑 주소"></label>`).join("");
  }
  function setupSheet() {
    const mode = $("mode"); mode.innerHTML = "";
    const add = (sel, v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); };
    if (canDemo) add(mode, "demo", "로컬 데모 (Hardhat 계정)");
    if (canWallet) add(mode, "metamask", "MetaMask 지갑");
    $("modeField").hidden = mode.options.length < 2 && !canDemo;
    const acc = $("demoAccount"); acc.innerHTML = "";
    if (canDemo) {
      add(acc, 0, "배포자(관리자) · 계정0");
      (CFG.members || []).forEach((m, i) => add(acc, i + 1, `${nm(i)} · ${short(m)}`));
      acc.value = "1";
    }
    updateSheet();
  }
  function updateSheet() {
    const isDemoMode = $("mode").value === "demo";
    $("demoAccountField").hidden = !isDemoMode;
    $("connectForm").hidden = connected || (!canWallet && !canDemo);
    $("connectedInfo").hidden = !connected;
    const noWallet = !connected && canWallet && !isDemoMode && !window.ethereum;
    $("installLink").hidden = !noWallet;
    $("btnConnect").textContent = noWallet && isMobile ? "MetaMask 앱에서 열기" : "연결하기";
    $("btnConnect").hidden = noWallet && !isMobile;
    $("sheetTitle").textContent = connected ? "지갑" : "지갑 연결";
    $("connectHint").textContent = connected ? "" : !canWallet && !canDemo
      ? "테스트넷 컨트랙트를 배포하면 지갑을 연결할 수 있어요. 지금은 샘플 화면으로 흐름을 둘러볼 수 있어요."
      : isDemoMode ? "이 PC에서 Hardhat 노드가 돌고 있어야 해요. 서명 창 없이 바로 처리돼요."
      : noWallet ? (isMobile ? "모바일에서는 MetaMask 앱 안의 브라우저에서 열어야 해요." : "이 브라우저에 MetaMask가 없어요. 설치한 뒤 새로고침해 주세요.")
      : `${chainName()} 네트워크의 지갑으로 연결해요. 네트워크가 다르면 전환을 요청해요.`;
    if (connected) { $("sheetAddr").textContent = short(me); $("sheetNet").textContent = chainName(); }
  }
  const chainName = () => CFG?.chainId === SEPOLIA ? "Sepolia 테스트넷" : CFG?.chainId === LOCAL_CHAIN ? "로컬 Hardhat" : `chainId ${CFG?.chainId}`;
  const openSheet = () => { updateSheet(); if (!$("sheet").open) $("sheet").showModal(); };
  const closeSheet = () => { if ($("sheet").open) $("sheet").close(); };

  $("walletChip").addEventListener("click", openSheet);
  $("sheetClose").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
  $("mode").addEventListener("change", updateSheet);
  $("btnConnect").addEventListener("click", () => {
    if ($("mode").value !== "demo" && !window.ethereum && isMobile) {
      location.href = `https://metamask.app.link/dapp/${location.host}${location.pathname}`;
      return;
    }
    connect();
  });
  $("demoAccount").addEventListener("change", () => { if (connected && demo) connect(); });
  $("btnDisconnect").addEventListener("click", disconnect);

  function chainHex(id) {
    const hex = "0x" + Number(id).toString(16);
    return Number(id) === SEPOLIA ? SEPOLIA_HEX : hex;
  }
  function walletErrorCode(e) {
    return e?.code ?? e?.error?.code ?? e?.data?.originalError?.code ?? e?.info?.error?.code;
  }
  function isRetryableRpc(e) {
    const code = e?.code || e?.info?.error?.code;
    const msg = `${e?.shortMessage || ""} ${e?.message || ""}`.toLowerCase();
    if (code === "ACTION_REJECTED" || code === 4001 || code === "CALL_EXCEPTION") return false;
    if (msg.includes("coalesce") || msg.includes("failed to detect network")) return true;
    if (code === "NETWORK_ERROR" || code === "SERVER_ERROR" || code === "TIMEOUT" || code === "UNKNOWN_ERROR") return true;
    if (msg.includes("missing response") || msg.includes("bad response") || msg.includes("timeout") || msg.includes("rate limit") || msg.includes("failed to fetch") || msg.includes("cors")) return true;
    const rpc = e?.error?.code ?? e?.info?.error?.code;
    return rpc === -32005 || rpc === -32603;
  }
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timerId = setTimeout(() => {
        const err = new Error("RPC timeout");
        err.code = "TIMEOUT";
        reject(err);
      }, ms);
      promise.then(v => { clearTimeout(timerId); resolve(v); }, e => { clearTimeout(timerId); reject(e); });
    });
  }
  function publicJsonProviders() {
    if (publicProviders) return publicProviders;
    const net = ethers.Network.from(SEPOLIA);
    publicProviders = READ_RPCS.map(url => new ethers.JsonRpcProvider(url, net, { staticNetwork: net }));
    return publicProviders;
  }
  function readBackends() {
    if (demo || chainIsLocal) return provider ? [provider] : [];
    const list = [];
    if (provider) list.push(provider);
    for (const p of publicJsonProviders()) list.push(p);
    return list;
  }
  async function readOp(run, opts = {}) {
    const all = readBackends();
    const skipWallet = opts.publicOnly || skipWalletReads;
    const backends = skipWallet ? all.filter(p => p !== provider) : all;
    const use = backends.length ? backends : all;
    let last;
    for (const backend of use) {
      try { return await withTimeout(Promise.resolve(run(backend)), 8000); }
      catch (e) {
        last = e;
        const wallet = backend === provider && !demo && !chainIsLocal;
        const hard = e?.code === "ACTION_REJECTED" || e?.code === 4001 || e?.code === "CALL_EXCEPTION";
        if (wallet && !hard) skipWalletReads = true;
        if (hard || (!wallet && !isRetryableRpc(e))) throw e;
        console.warn("읽기 RPC 실패, 다음 엔드포인트로 넘어갑니다.", e?.shortMessage || e?.message || e);
      }
    }
    throw last || new Error("Sepolia 읽기 RPC에 연결하지 못했어요.");
  }
  function makeReadRunner() {
    const runner = {
      provider: null,
      getNetwork: () => Promise.resolve(ethers.Network.from(demo || chainIsLocal ? (CFG?.chainId || LOCAL_CHAIN) : SEPOLIA)),
      call: (tx) => readOp(p => p.call(tx)),
      getLogs: (filter) => readOp(p => p.getLogs(filter)),
      getCode: (address, blockTag) => readOp(p => p.getCode(address, blockTag)),
      getBlock: (tag) => readOp(p => p.getBlock(tag)),
      getBlockNumber: () => readOp(p => p.getBlockNumber()),
      getBalance: (address, blockTag) => readOp(p => p.getBalance(address, blockTag)),
      estimateGas: (tx) => readOp(p => p.estimateGas(tx)),
    };
    runner.provider = runner;
    return runner;
  }
  function reader() {
    if (demo || chainIsLocal) return provider;
    if (!readRunner) readRunner = makeReadRunner();
    return readRunner;
  }
  function emptyOverview() {
    const zeros = Array(6).fill(ethers.ZeroAddress);
    return {
      status: 0n,
      memberAccounts: zeros,
      depositedFlags: Array(6).fill(false),
      hasLeft: Array(6).fill(false),
      leaveFromRound: Array(6).fill(0),
      createdAt: 0n,
      depositDeadline: 0n,
      currentRound: 0n,
      carryOver: 0n,
      escrowBalance: 0n,
      outstandingClaims: 0n,
      isFinalized: false,
    };
  }
  async function readOverview() {
    try {
      return await escrowRead.getStudyOverview();
    } catch (e) {
      try {
        const status = Number(await escrowRead.status());
        if (status === ST_NONE) return emptyOverview();
      } catch (_) { /* status도 실패하면 원래 오류를 올린다 */ }
      throw e;
    }
  }
  async function ensureChain() {
    const want = chainHex(CFG.chainId);
    const current = async () => (await window.ethereum.request({ method: "eth_chainId" })).toLowerCase();
    if (await current() === want) return;
    switchingChain = true;
    try {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
      } catch (e) {
        const code = Number(walletErrorCode(e));
        if (code === 4001) throw new Error("네트워크 전환을 거부했어요");
        if (code !== 4902 || Number(CFG.chainId) !== SEPOLIA) throw e;
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
          chainId: want,
          chainName: "Sepolia",
          nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: READ_RPCS,
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        }] });
        if (await current() !== want) {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
        }
      }
      for (let i = 0; i < 25; i++) {
        try { if (await current() === want) return; } catch (_) { /* 전환 중 eth_chainId가 잠시 실패할 수 있다 */ }
        await new Promise(r => setTimeout(r, 120));
      }
      throw new Error("Sepolia(0xaa36a7)로 전환되지 않았어요. MetaMask에서 네트워크를 바꾼 뒤 다시 연결해 주세요.");
    } finally {
      switchingChain = false;
    }
  }
  function remember(on) {
    try { on ? localStorage.setItem("ae.wallet", "1") : localStorage.removeItem("ae.wallet"); } catch (_) { /* 저장 불가 */ }
  }
  async function connect() {
    try {
      if (!CFG || !ABI) throw new Error("config.js 또는 abi.js가 없어요.");
      demo = $("mode").value === "demo";
      if (demo) {
        provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        signer = await provider.getSigner(Number($("demoAccount").value));
      } else {
        if (!window.ethereum) throw new Error("MetaMask가 없어요.");
        await window.ethereum.request({ method: "eth_requestAccounts" });
        await ensureChain();
        // 전환이 끝난 뒤에 Provider를 새로 만든다. 이전 네트워크가 캐시되면 coalesce 오류가 난다.
        provider = new ethers.BrowserProvider(window.ethereum, chainIsLocal ? LOCAL_CHAIN : SEPOLIA);
        signer = await provider.getSigner();
        if (!listening) {
          listening = true;
          window.ethereum.on?.("accountsChanged", (a) => { if (!a.length) disconnect(); else if (connected) connect(); });
          window.ethereum.on?.("chainChanged", () => { if (!switchingChain) location.reload(); });
        }
        remember(true);
      }
      me = await signer.getAddress();
      const chainId = demo || chainIsLocal
        ? Number((await provider.getNetwork()).chainId)
        : parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
      if (chainId !== Number(CFG.chainId)) throw new Error(`연결된 체인(${chainId})이 배포 체인(${CFG.chainId})과 달라요.`);
      readRunner = null;
      skipWalletReads = false;
      const code = await readOp(p => p.getCode(CFG.escrow));
      if (!code || code === "0x") throw new Error("이 체인에서 에스크로 컨트랙트를 찾지 못했어요.");
      escrow = new ethers.Contract(CFG.escrow, ABI.StudyEscrow, signer);
      sdt = new ethers.Contract(CFG.sdt, ABI.MockSDT, signer);
      sbt = new ethers.Contract(CFG.sbt, ABI.AttendanceSBT, signer);
      const viewRunner = reader();
      escrowRead = new ethers.Contract(CFG.escrow, ABI.StudyEscrow, viewRunner);
      sdtRead = new ethers.Contract(CFG.sdt, ABI.MockSDT, viewRunner);
      sbtRead = new ethers.Contract(CFG.sbt, ABI.AttendanceSBT, viewRunner);
      ifaceAll = new ethers.Interface([...ABI.StudyEscrow, ...ABI.MockSDT.filter(f => f.type === "error"), ...ABI.AttendanceSBT.filter(f => f.type === "error")]);
      chainParams = null;
      logs = []; logsTo = null; logsPartial = false;
      const first = $("roster0");
      if (first && !first.value) first.value = me;
      await refresh();
      connected = true;
      $("walletChip").classList.remove("off");
      $("walletText").textContent = short(me);
      $("sampleBar").hidden = true;
      $("demoPanel").hidden = !demo;
      renderContracts();
      $("netLabel").textContent = `${chainName()} · chainId ${chainId}`;
      renderAll();
      closeSheet();
      msg("연결됐어요 " + short(me), "ok");
      clearInterval(timer);
      timer = setInterval(() => { if (!document.hidden && !busy) refresh().catch(() => {}); }, POLL_MS);
    } catch (e) {
      console.error(e);
      connected = false;
      msg("연결 실패: " + explain(e), "err");
    }
  }
  function disconnect() {
    clearInterval(timer); timer = null;
    connected = false; demo = false;
    escrow = sdt = sbt = escrowRead = sdtRead = sbtRead = signer = provider = me = null;
    readRunner = null; publicProviders = null; skipWalletReads = false; chainParams = null; knownFrom = null;
    logs = []; logsTo = null;
    remember(false);
    $("walletChip").classList.add("off");
    $("walletText").textContent = "지갑 연결";
    $("demoPanel").hidden = true;
    closeSheet();
    enterSample();
  }

  async function loadParams() {
    if (chainParams) return chainParams;
    const [perRound, rounds, threshold, depositWindow, lateWindow, attestWindow, depositAmount, votingPeriod, finalizeDelay] = await Promise.all([
      escrowRead.ROUND_SHARE(), escrowRead.TOTAL_ROUNDS(), escrowRead.ATTEST_THRESHOLD(), escrowRead.DEPOSIT_WINDOW(),
      escrowRead.LATE_GRACE(), escrowRead.ATTEST_WINDOW(), escrowRead.DEPOSIT_AMOUNT(), escrowRead.VOTING_PERIOD(), escrowRead.FINALIZE_DELAY(),
    ]);
    chainParams = {
      perRound, rounds: Number(rounds), threshold: Number(threshold), depositWindow: Number(depositWindow),
      lateWindow: Number(lateWindow), attestWindow: Number(attestWindow), depositAmount,
      votingPeriod: Number(votingPeriod), finalizeDelay: Number(finalizeDelay), half: perRound / 2n,
    };
    return chainParams;
  }

  async function refresh() {
    if (!escrow) return;
    const seq = ++refreshSeq;
    let overview, cfg, block;
    try {
      [overview, cfg, block] = await Promise.all([readOverview(), loadParams(), readOp(p => p.getBlock("latest"))]);
    } catch (e) {
      // createStudy 전(Status 0)이면 조회가 일부 실패해도 만들기 화면으로 남긴다.
      let status = -1;
      try { status = Number(await escrowRead.status()); } catch (_) { throw e; }
      if (status !== ST_NONE) throw e;
      overview = emptyOverview();
      try { cfg = await loadParams(); } catch (_) { cfg = fallbackCfg(); }
      try { block = await readOp(p => p.getBlock("latest")); }
      catch (_) { block = { timestamp: Math.floor(Date.now() / 1000), number: 0 }; }
    }
    const now = Number(block.timestamp);
    const st = Number(overview.status);
    const members = st === ST_NONE ? [] : Array.from(overview.memberAccounts);
    const r = Number(overview.currentRound);
    const myIdx = members.findIndex(a => same(a, me));
    const isMember = myIdx >= 0;
    const depFlags = st === ST_NONE ? [] : Array.from(overview.depositedFlags).map(Boolean);
    const hasLeft = st === ST_NONE ? [] : Array.from(overview.hasLeft).map(Boolean);
    const leaveFrom = st === ST_NONE ? [] : Array.from(overview.leaveFromRound).map(Number);
    const depCount = depFlags.filter(Boolean).length;
    const myDep = isMember && depFlags[myIdx];
    const depDeadline = Number(overview.depositDeadline);
    const carry = overview.carryOver;

    const roundData = {};
    if (r > 0) {
      const all = await Promise.all(Array.from({ length: r }, (_, i) => escrowRead.getRound(i + 1)));
      all.forEach((rd, i) => { roundData[i + 1] = aliasRound(rd, cfg.lateWindow); });
    }
    const rd = r > 0 ? roundData[r] : null;
    const settledN = r > 0 ? (rd.settled ? r : r - 1) : 0;
    const readyAt = r > 0 && rd.opened && !rd.settled ? Number(await escrowRead.settlementReadyAt(r)) : 0;
    const phase = phaseOf(rd, now, cfg.lateWindow, readyAt);

    const payouts = {};
    if (settledN > 0) {
      const jobs = [];
      for (let k = 1; k <= settledN; k++) {
        for (let i = 0; i < members.length; i++) {
          jobs.push(escrowRead.roundPayout(k, i).then((v) => { payouts[`${k}:${i}`] = v; }));
        }
      }
      await Promise.all(jobs);
    }
    const rowFor = (k, settled) => members.map((a, i) => {
      const source = roundData[k];
      const kind = kindOf(source, i, k, hasLeft, leaveFrom, cfg.threshold);
      const ui = settled ? statusOf(source, i, kind) : 0;
      const got = payouts[`${k}:${i}`] || 0n;
      const base = basePayout(kind, source.attesterPenalized[i], cfg.perRound, cfg.half);
      const refund = got > base ? base : got;
      const share = got > base ? got - base : 0n;
      return {
        addr: a, i, status: ui, kind, attestCount: Number(source.attestCount[i]), excused: source.excused[i],
        fraud: source.fraud[i], penalized: !!source.attesterPenalized[i], refund, share, got, payout: got,
      };
    });
    const hist = [];
    for (let k = settledN; k >= 1; k--) {
      const rows = rowFor(k, true);
      const count = [0, 0, 0, 0, 0];
      rows.forEach(x => count[x.status]++);
      const present = rows.filter(x => x.kind === KIND_ON_TIME && !x.penalized).length;
      const share = present > 0 ? roundData[k].distributed / BigInt(present) : 0n;
      hist.push({ round: k, rd: roundData[k], rows, present, share, count, mine: isMember ? rows[myIdx] : null });
    }

    const mrs = r > 0 ? members.map((a, i) => {
      const kind = kindOf(rd, i, r, hasLeft, leaveFrom, cfg.threshold);
      return {
        proofHash: rd.proofHashes[i], late: !!rd.late[i], attestCount: Number(rd.attestCount[i]),
        status: rd.settled ? statusOf(rd, i, kind) : 0, kind, proofAt: Number(rd.submittedAt[i]),
        excused: !!rd.excused[i], fraud: !!rd.fraud[i], penalized: !!rd.attesterPenalized[i],
        submitted: !!rd.submitted[i], payout: payouts[`${r}:${i}`] || 0n,
      };
    }) : [];
    const mine = isMember && r > 0 ? mrs[myIdx] : null;
    const hasProof = !!(mine && mine.proofHash !== ethers.ZeroHash);
    const attestedByMe = isMember && r > 0
      ? await Promise.all(members.map((_, i) => escrowRead.hasAttested(r, myIdx, i)))
      : [];
    const myAttesters = [];
    if (isMember && r > 0) {
      const flags = await Promise.all(members.map((_, i) => escrowRead.hasAttested(r, i, myIdx)));
      flags.forEach((ok, i) => { if (ok) myAttesters.push(members[i]); });
    }

    const [sdtBal, bal, sbtBal, allowance, proposalCount] = await Promise.all([
      sdtRead.balanceOf(me), escrowRead.withdrawableOf(me), sbtRead.balanceOf(me), sdtRead.allowance(me, CFG.escrow), escrowRead.proposalCount(),
    ]);
    const nProp = Number(proposalCount);
    const proposals = nProp ? await Promise.all(Array.from({ length: nProp }, async (_, n) => {
      const id = n + 1;
      const p = await escrowRead.getProposal(id);
      const voted = isMember ? await escrowRead.voted(id, myIdx) : false;
      return {
        id, type: Number(p.proposalType), proposer: Number(p.proposerIndex), target: Number(p.targetIndex),
        newWallet: p.newWallet, roundId: Number(p.roundId), deadline: Number(p.deadline),
        yes: Number(p.yesVotes), no: Number(p.noVotes), executed: p.executed, voted,
      };
    })) : [];

    let att = 0;
    if (isMember) {
      for (let k = 1; k <= r; k++) if (roundData[k].attendedRound[myIdx]) att++;
    }
    const locked = lockedAmount(st, myIdx, myDep, settledN, cfg.rounds, cfg.perRound, hasLeft, leaveFrom);
    await loadEvents(Number(block.number));
    if (seq !== refreshSeq) return;

    const returned = hist.reduce((acc, h) => acc + (h.mine ? h.mine.got : 0n), 0n) + finalizeCredit(me);
    S = {
      members, cfg, st, r, rd, rounds: cfg.rounds, threshold: cfg.threshold, now, myIdx, isMember,
      sdtBal, locked, bal, att, sbtBal: Number(sbtBal), allowance, phase, depFlags, depCount, myDep,
      total: cfg.depositAmount, depDeadline, mrs, mine, hasProof, attestedByMe, myAttesters, hist, returned,
      settledN, carry, readyAt, proposals, hasLeft,
    };
    renderAll();
    renderLog();
  }

  function lockedAmount(st, myIdx, myDep, settledN, rounds, per, hasLeft, leaveFrom) {
    if (myIdx < 0 || !myDep || st === ST_NONE || st === ST_CANCELLED || st === ST_FINAL) return 0n;
    if (st === ST_CREATED) return per * BigInt(rounds);
    const remain = hasLeft[myIdx] ? Math.max(0, leaveFrom[myIdx] - 1 - settledN) : Math.max(0, rounds - settledN);
    return per * BigInt(remain);
  }
  function finalizeCredit(account) {
    const txs = new Set(logs.filter(l => l.name === "StudyFinalized").map(l => l.tx));
    return logs.reduce((acc, l) => acc + (l.name === "Distributed" && txs.has(l.tx) && same(l.args.member, account) ? l.args.amount : 0n), 0n);
  }

  let knownFrom = null;
  async function codeAt(block) {
    try {
      const code = await readOp(p => p.getCode(CFG.escrow, block));
      return !!(code && code !== "0x");
    } catch (_) {
      // 과거 블록 상태 조회가 거절되어도 로그 조회는 이어서 한다.
      return null;
    }
  }
  async function findFromBlock(latest) {
    if (knownFrom !== null) return knownFrom;
    if (Number.isInteger(CFG.deployBlock)) { knownFrom = CFG.deployBlock; return knownFrom; }
    if (chainIsLocal) { knownFrom = 0; return 0; }
    // 제네시스부터 찾지 않는다. 과거 eth_getCode가 MetaMask RPC에서 coalesce 오류를 낸다.
    const floor = Math.max(0, latest - LOG_LOOKBACK);
    let lo = floor, hi = latest;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const has = await codeAt(mid);
      if (has === null) { knownFrom = floor; return floor; }
      if (has) hi = mid;
      else lo = mid + 1;
    }
    knownFrom = lo;
    return lo;
  }
  function logRow(l) {
    const name = l.fragment?.name || l.eventName;
    if (!name) return null;
    return { block: l.blockNumber, name, args: l.args, tx: l.transactionHash, logIndex: l.index ?? l.logIndex ?? 0 };
  }
  async function loadEvents(latest) {
    try {
      const start = logsTo !== null ? logsTo + 1 : await findFromBlock(latest);
      for (let from = start; from <= latest; from += LOG_CHUNK) {
        const to = Math.min(from + LOG_CHUNK - 1, latest);
        const [escrowLogs, tokenLogs] = await Promise.all([
          escrowRead.queryFilter("*", from, to),
          sdtRead.queryFilter("Transfer", from, to),
        ]);
        const batch = [];
        for (const l of [...escrowLogs, ...tokenLogs]) {
          const row = logRow(l);
          if (row) batch.push(row);
        }
        logs.push(...batch);
        logsTo = to;
      }
      logs.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
      logsPartial = false;
    } catch (e) {
      console.error(e);
      logsPartial = true;
    }
  }

  function coinLine(entry) {
    const { name: n, args: a, block } = entry;
    const who = (addr) => nameOf(S.members || [], addr);
    if (n === "Transfer") {
      if (a.from === ethers.ZeroAddress) return ["SDT 수령", `${who(a.to)} · ${fmt(a.value)} SDT · 블록 ${block}`];
      if (same(a.to, CFG.escrow)) return ["예치 전송", `${who(a.from)} → 에스크로 · ${fmt(a.value)} SDT · 블록 ${block}`];
      if (same(a.from, CFG.escrow)) return ["출금 전송", `에스크로 → ${who(a.to)} · ${fmt(a.value)} SDT · 블록 ${block}`];
      return ["SDT 전송", `${who(a.from)} → ${who(a.to)} · ${fmt(a.value)} SDT · 블록 ${block}`];
    }
    if (n === "Deposited") return ["예치", `${who(a.member)} · ${fmt(a.amount)} SDT · 블록 ${block}`];
    if (n === "Distributed") return ["정산 분배", `${a.roundId}회차 · ${who(a.member)} · +${fmt(a.amount)} SDT · 블록 ${block}`];
    if (n === "Refunded") return ["환급·인출", `${who(a.member)} · ${fmt(a.amount)} SDT · 블록 ${block}`];
    return [n, `블록 ${block}`];
  }
  function actLine(entry) {
    const { name: n, args: a, block } = entry;
    const who = (addr) => nameOf(S.members || [], addr);
    switch (n) {
      case "StudyCreated": return ["스터디 등록", `예치 마감 ${ts(a.depositDeadline)} · 블록 ${block}`];
      case "RoundOpened": return [`${a.roundId}회차 시작`, `제출 마감 ${ts(a.submitDeadline)} · 확인 마감 ${ts(a.attestDeadline)} · 블록 ${block}`];
      case "ProofSubmitted": return [`${a.roundId}회차 증빙`, `${who(a.member)} · ${short(a.proofHash)}${a.late ? " · 지각" : ""} · 블록 ${block}`];
      case "Attested": return [`${a.roundId}회차 확인`, `${who(a.attester)} → ${who(a.member)} · 블록 ${block}`];
      case "RoundSettled": return [`${a.roundId}회차 정산`, `정시 ${a.onTimeCount} · 지각 ${a.lateCount} · 결석 ${a.absentCount} · 분배 풀 ${fmt(a.distributedPot)} SDT · 블록 ${block}`];
      case "DisputeOpened": return [`${a.roundId}회차 이의`, `${who(a.by)} · 정산 보류 ${ts(a.until)} · 블록 ${block}`];
      case "DisputeResolved": return [`${a.roundId}회차 이의 종료`, `블록 ${block}`];
      case "MemberLeft": return ["중도 탈퇴", `${who(a.member)} · ${a.fromRound}회차부터 · 블록 ${block}`];
      case "ProposalCreated": return [`안건 ${a.proposalId}`, `${PROP[Number(a.proposalType)] || "안건"} · ${who(a.proposer)} → ${who(a.target)} · 블록 ${block}`];
      case "VoteCast": return [`안건 ${a.proposalId} 투표`, `${who(a.voter)} · ${a.support ? "찬성" : "반대"} · 블록 ${block}`];
      case "ProposalExecuted": return [`안건 ${a.proposalId} 실행`, `블록 ${block}`];
      case "WalletReplaced": return ["지갑 교체", `${short(a.oldWallet)} → ${short(a.newWallet)} · 블록 ${block}`];
      case "StudyFinalized": return ["최종 정산", `개근 ${a.perfectCount}명 · 잔액 ${fmt(a.leftover)} SDT · 블록 ${block}`];
      default: return null;
    }
  }
  function renderLog() {
    const note = logsPartial ? emptyRow("일부 기록을 불러오지 못했어요. 잠시 뒤 다시 읽어요.") : "";
    const newest = logs.slice().reverse();
    const coin = newest.filter(l => COIN_EVENTS.has(l.name)).map(l => ({ line: coinLine(l), tx: l.tx }));
    const act = newest.map(l => ({ line: actLine(l), tx: l.tx })).filter(x => x.line);
    $("coinHistory").innerHTML = note + (coin.length ? coin.map(x => historyRow(x.line[0], x.line[1], x.tx)).join("") : emptyRow("아직 입출금·정산 이력이 없어요"));
    $("eventLog").innerHTML = note + (act.length ? act.map(x => historyRow(x.line[0], x.line[1], x.tx)).join("") : emptyRow("아직 활동 기록이 없어요"));
  }

  function renderAll() { renderHome(); renderDeposit(); renderProof(); renderAttest(); renderSettle(); renderExcuse(); renderActions(); ensureDeadlines(); }

  function ensureDeadlines() {
    const sub = $("submitDeadline");
    if (!connected || !sub || sub.value || !S.now) return;
    const submit = S.now + 3 * 86400;
    const attest = submit + Number(S.cfg?.attestWindow || 172800);
    sub.value = localInput(submit);
    $("attestDeadline").value = localInput(attest);
  }
  function setStep(id, state, em) {
    const el = $(id), b = el.querySelector("b");
    b.className = state === "done" ? "" : state;
    const e = el.querySelector("em"); if (e && em !== undefined) e.textContent = em;
  }

  function renderHome() {
    const { st, r, rd, rounds, threshold, now, isMember, locked, bal, phase, myDep, hasProof, mine, hist, returned, settledN, depCount, members } = S;
    const need = members.length - depCount;
    $("homeSub").textContent = st === ST_NONE ? "스터디원 6명을 등록하면 예치가 시작돼요"
      : !isMember ? "등록된 스터디원 지갑이 아니에요"
      : st === ST_CREATED ? "전원이 예치하면 스터디가 시작돼요"
      : st === ST_CANCELLED ? "예치 기한 안에 전원이 넣지 않아 취소됐어요"
      : st === ST_FINAL ? "모든 회차가 끝났어요"
      : `${members.length}명 · ${rounds}회차 · 확인 ${threshold}명이면 출석`;
    $("homeLocked").textContent = fmt(locked);
    const pct = rounds ? Math.round(100 * settledN / rounds) : 0;
    $("homeBar").style.width = pct + "%";
    $("homeProg").setAttribute("aria-valuenow", String(pct));
    $("homeBarText").textContent = st === ST_NONE ? "스터디 등록 전"
      : st === ST_CREATED ? `예치 ${depCount} / ${members.length}명 · 시작 전`
      : st === ST_CANCELLED ? "취소됨 · 넣은 금액은 지갑으로 돌아갔어요"
      : st === ST_FINAL ? `${settledN} / ${rounds}회차 완료`
      : `${settledN} / ${rounds}회차 정산됨`;

    let k = "", t = "", d = "";
    if (st === ST_NONE) { k = "등록 전"; t = "스터디 만들기"; d = "예치 화면에서 스터디원 6명의 지갑을 등록해요."; }
    else if (!isMember) { k = "안내"; t = "스터디원 지갑으로 연결해 주세요"; d = "이 지갑은 스터디에 등록되어 있지 않아요. 정산 버튼은 누구나 누를 수 있어요."; }
    else if (st === ST_CREATED) { k = "시작 전"; t = "보증금 예치"; d = myDep ? `${need}명이 더 넣으면 스터디가 시작돼요.` : `${fmt(S.total)} SDT를 넣으면 돼요. ${ts(S.depDeadline)}까지 · ${remain(S.depDeadline, now)}`; }
    else if (st === ST_ACTIVE && r > 0 && !rd.settled) {
      k = `이번 회차 · 모듈 ${r}`; t = MODULES[r] || `모듈 ${r}`;
      if (phase === 1) d = hasProof ? "증빙을 냈어요. 이제 다른 스터디원 증빙을 확인해 주세요." : `${ts(rd.proofDeadline)} 마감 · ${remain(rd.proofDeadline, now)}`;
      else if (phase === 2) d = hasProof ? "증빙을 냈어요. 다른 스터디원 증빙을 확인해 주세요." : `제출 마감이 지났어요. ${ts(rd.lateDeadline)}까지 내면 지각으로 접수되고 회차 몫의 절반만 돌아와요.`;
      else if (phase === 3) d = hasProof ? `확인 ${mine.attestCount} / ${threshold} · 정산 가능 ${remain(S.readyAt, now)}` : "제출 기간이 끝났어요. 확인이 모자라면 이번 회차는 결석이에요.";
      else d = "정산 가능 시각이 지났어요. 누구든 정산을 누르면 환급과 분배가 적립되고, 출석·지각 배지가 발행돼요.";
    } else if (st === ST_ACTIVE) {
      k = r === 0 ? "시작" : "정산 완료";
      t = r < rounds ? `다음 · 모듈 ${r + 1}` : "최종 정산";
      d = r < rounds ? `${MODULES[r + 1] || ""}. 회차를 열 때 제출 마감과 확인 마감을 정해요.` : `마지막 회차 정산 ${S.cfg.finalizeDelay / 86400}일 뒤에 최종 정산을 할 수 있어요. 개근 배지와 남은 잔액을 나눠요.`;
    } else {
      k = st === ST_CANCELLED ? "취소" : "종료";
      t = st === ST_CANCELLED ? "스터디 취소" : "스터디 종료";
      d = st === ST_CANCELLED ? "넣은 SDT는 취소 트랜잭션으로 바로 돌아갔어요." : bal > 0n ? "돌려받을 금액이 있어요. 아래에서 인출해 주세요." : "정산이 모두 끝났어요.";
    }
    $("taskK").textContent = k; $("taskT").textContent = t; $("taskD").textContent = d;

    const showPhases = st === ST_ACTIVE && r > 0 && rd && !rd.settled;
    $("phaseSteps").hidden = !showPhases;
    if (showPhases) {
      const names = ["증빙 제출", "지각 접수", "상호 확인", "정산"];
      $("phaseSteps").innerHTML = names.map((n, i) => {
        const cls = i + 1 < phase ? "past" : i + 1 === phase ? "now" : "";
        return `<li class="${cls}"${i + 1 === phase ? ' aria-current="step"' : ""}>${n}</li>`;
      }).join("");
    }

    const statusOfRound = (n) => hist.find(h => h.round === n)?.mine?.status;
    const presentN = hist.filter(h => h.mine?.status === 1).length;
    $("roundSummary").textContent = settledN ? `출석 ${presentN} / ${settledN}` : "";
    $("roundGrid").innerHTML = Array.from({ length: rounds }, (_, i) => {
      const n = i + 1, s = statusOfRound(n), isNow = st === ST_ACTIVE && n === r && rd && !rd.settled;
      const label = `${n}회차 ${MODULES[n] || ""}: ${s ? ATT[s] : isNow ? "진행 중" : "예정"}`;
      return `<li class="${s ? "s" + s : isNow ? "now" : ""}" title="${label}" aria-label="${label}">${n}</li>`;
    }).join("");

    $("homeReturned").textContent = "+" + fmt(returned);
    $("homeList").innerHTML = hist.slice(0, 3).map(h => {
      const m = h.mine, stn = m ? m.status : 0;
      const label = `${h.round}회차 · 정시 ${h.count[1] || 0}명${h.count[3] ? ` · 결석 ${h.count[3]}명` : ""}${h.count[2] ? ` · 지각 ${h.count[2]}명` : ""}${h.count[4] ? ` · 공결 ${h.count[4]}명` : ""}`;
      const right = !m ? "" : m.got > 0n ? `<span class="r ok">+${fmt(m.got)}</span>` : `<span class="r warn">${ATT[stn]}</span>`;
      return `<li class="li"><span class="av num" aria-hidden="true">${h.round}</span><span class="who">${label}</span>${right}</li>`;
    }).join("") || emptyRow("정산된 회차가 생기면 여기에 쌓여요");
    $("btnWithdraw").hidden = bal <= 0n;
    $("btnWithdraw").textContent = `인출 가능 ${fmt(bal)} SDT · 내 지갑으로 보내기`;
  }

  function renderDeposit() {
    const { st, members, depFlags, depCount, myDep, total, cfg, rounds, depDeadline, now, sdtBal, isMember } = S;
    const all = members.length > 0 && depCount === members.length;
    $("createCard").hidden = !(connected && st === ST_NONE);
    $("depSub").textContent = st === ST_NONE ? "먼저 스터디원 6명을 등록해요" : st !== ST_CREATED ? "예치는 끝났어요" : myDep ? "내 보증금은 들어가 있어요" : "보증금을 걸면 스터디가 시작돼요";
    $("depTotal").textContent = fmt(total);
    $("depDesc").textContent = `${rounds}회 × ${fmt(cfg.perRound)} SDT`;
    $("depNote").textContent = st === ST_NONE ? "등록한 뒤 72시간 안에 6명이 35,000 SDT씩 넣으면 스터디가 시작돼요."
      : st === ST_CREATED ? `${ts(depDeadline)}까지 전원이 예치하면 스터디가 시작돼요 (${remain(depDeadline, now)}). 기한을 넘기면 넣은 금액은 전액 지갑으로 돌아와요.`
      : st === ST_CANCELLED ? "예치 기한 안에 전원이 넣지 않아 취소됐어요. 넣은 SDT는 취소 트랜잭션으로 바로 돌아갔어요."
      : "전원이 예치해서 스터디가 시작됐어요. 정시 출석이면 회차 몫이 돌아오고, 결석·지각 몰수분은 정시 출석한 사람들이 나눠 가져요. 토큰은 정산 뒤 홈에서 인출해요.";
    $("depChip").textContent = `${depCount} / ${members.length}명`;
    $("depChip").className = "chip sm " + (all ? "ok" : "warn");
    $("depList").innerHTML = members.length ? members.map((a, i) =>
      `<li class="li">${av(i, !depFlags[i])}<span class="who">${nm(i)}${i === S.myIdx ? ' <span class="me-tag">· 나</span>' : ""}<small class="mono">${short(a)}</small></span>${depFlags[i] ? `<span class="done">완료</span>` : `<span class="r">아직</span>`}</li>`).join("")
      : emptyRow("등록된 스터디원이 없어요");
    $("sdtBal").textContent = fmt(sdtBal);
    $("btnFaucet").disabled = connected && demo && !isMember;
    $("btnCancel").hidden = !(st === ST_CREATED && now > depDeadline);
  }

  function renderProof() {
    const { r, rd, phase, hasProof, mine, threshold, now, isMember, myAttesters, members, mrs } = S;
    const open = r > 0 && rd && !rd.settled;
    $("proofH1").textContent = r > 0 ? `모듈 ${r} 증빙 제출` : "증빙 제출";
    $("proofSub").textContent = !open ? "지금은 낼 증빙이 없어요" : MODULES[r] || `${r}회차`;
    if (hasProof) {
      setStep("step1", "done", "완료"); setStep("step2", "done", "완료"); setStep("step3", "done", "제출됨");
      $("step3Text").textContent = mine.late ? "캡처 파일 제출 · 지각 접수" : "캡처 파일 제출";
      $("proofBox").textContent = `제출 ${ts(mine.proofAt)}`;
      $("proofHash").className = "hash"; $("proofHash").textContent = mine.proofHash;
    } else {
      setStep("step1", steps.s1 ? "done" : "off", steps.s1 ? "체크함" : "눌러서 체크");
      setStep("step2", steps.s2 ? "done" : "off", steps.s2 ? "체크함" : "눌러서 체크");
      setStep("step3", pendingHash ? "done" : "off", pendingFile ? "선택됨" : "탭해서 선택");
      $("step3Text").textContent = "캡처 파일 선택";
      $("proofBox").textContent = pendingFile ? `${pendingFile} · ${ts(pendingAt)}` : "파일을 고르면 이름과 시각이 여기에 표시돼요";
      $("proofHash").className = "hash" + (pendingHash ? "" : " empty"); $("proofHash").textContent = pendingHash || "파일을 고르면 이 기기에서 해시를 계산해요";
    }
    $("step1").setAttribute("aria-pressed", String(hasProof || steps.s1));
    $("step2").setAttribute("aria-pressed", String(hasProof || steps.s2));
    $("dupWarn").hidden = !(pendingHash && !hasProof && (mrs || []).some((x, i) => i !== S.myIdx && x.proofHash === pendingHash));
    const due = $("proofDue");
    if (!open) { due.textContent = "열린 회차가 없어요"; due.className = "due mute"; }
    else if (phase === 1) { due.textContent = `마감 ${ts(rd.proofDeadline)} · ${remain(rd.proofDeadline, now)}`; due.className = "due"; }
    else if (phase === 2) { due.textContent = `지각 접수 ${ts(rd.lateDeadline)}까지 · 회차 몫의 절반만 돌아와요`; due.className = "due"; }
    else { due.textContent = hasProof ? `제출 완료 · 정산 가능 ${remain(S.readyAt, now)}` : "제출 기간이 끝났어요"; due.className = "due mute"; }
    $("myAttCard").hidden = !hasProof;
    if (hasProof) {
      $("myAttChip").textContent = `${mine.attestCount} / ${threshold}`;
      $("myAttChip").className = "chip sm " + (Number(mine.attestCount) >= threshold ? "ok" : "mute");
      $("myAttesters").innerHTML = myAttesters.length ? myAttesters.map(a => {
        const i = members.findIndex(x => same(x, a));
        return `<li class="li">${av(Math.max(i, 0))}<span class="who">${nameOf(members, a)}</span><span class="done">확인함</span></li>`;
      }).join("") : emptyRow("아직 확인한 사람이 없어요");
    }
    const lock = hasProof || !open || !isMember || phase > 2;
    $("step1").disabled = $("step2").disabled = lock;
    $("step3").classList.toggle("locked", lock);
    $("proofFile").disabled = lock;
  }

  function renderAttest() {
    const { r, rd, phase, threshold, hasProof, mine, now, members, mrs, attestedByMe, isMember, myIdx, cfg } = S;
    const open = r > 0 && rd && !rd.settled;
    const n = hasProof ? Number(mine.attestCount) : 0;
    $("attN").textContent = n; $("attD").textContent = threshold;
    $("attSub").textContent = !open ? "열린 회차가 없어요" : `본인 제외 ${members.length - 1}명 중 ${threshold}명이 확인하면 출석이에요`;
    const hashes = (mrs || []).map(x => x.proofHash);
    $("attestList").innerHTML = !open ? emptyRow("열린 회차가 없어요") : members.map((a, i) => {
      if (i === myIdx) return "";
      const x = mrs[i], p = x.proofHash !== ethers.ZeroHash;
      const key = `${r}:${a}`, v = verified[key];
      const dup = p && hashes.filter(h => h === x.proofHash).length > 1;
      const tag = x.fraud ? ' <span class="chip sm warn">허위</span>' : v === true ? ' <span class="chip sm ok">캡처 일치</span>' : v === false ? ' <span class="chip sm warn">캡처 불일치</span>' : dup ? ' <span class="chip sm warn">중복 해시</span>' : "";
      const close = p ? attestClose(x, rd, cfg.attestWindow) : 0;
      const canAttest = isMember && open && !x.fraud && now <= close && phase < 5;
      const acts = !p ? `<span class="r">증빙 미제출</span>`
        : `<span class="acts"><button class="sbtn line" data-verify="${a}" type="button" aria-label="${nm(i)} 캡처 대조">대조</button>${attestedByMe[i] ? `<span class="done">확인함</span>` : `<button class="sbtn" data-attest="${a}" type="button" aria-label="${nm(i)} 증빙 확인" ${canAttest ? "" : "disabled"}>확인</button>`}</span>`;
      return `<li class="li">${av(i, !p)}<span class="who">${nm(i)}${tag}<small>${p ? `<span class="mono">${short(x.proofHash)}</span>${x.late ? " · 지각" : ""} · 확인 ${x.attestCount}/${threshold}` : "-"}</small></span>${acts}</li>`;
    }).join("");
    document.querySelectorAll("[data-attest]").forEach(b => { b.onclick = () => tx("확인 서명", () => escrow.attest(b.dataset.attest)); });
    document.querySelectorAll("[data-verify]").forEach(b => { b.onclick = () => { verifyTarget = b.dataset.verify; $("verifyFile").click(); }; });
    const due = $("attDue");
    if (!open) { due.textContent = "-"; due.className = "due mute"; }
    else if (phase <= 3) { due.textContent = `확인·정산 ${remain(S.readyAt, now)}`; due.className = "due"; }
    else { due.textContent = "정산 가능 시각이 지났어요"; due.className = "due mute"; }
  }

  function renderSettle() {
    const { st, r, rd, rounds, hist, cfg, sbtBal, bal, carry, phase, readyAt, now } = S;
    const last = hist[0];
    if (!last) {
      $("setH1").textContent = "정산"; $("setSub").textContent = "아직 정산된 회차가 없어요";
      $("setChips").innerHTML = ""; $("setAmtCard").hidden = true; $("setCard").hidden = true;
      $("sbtBadge").hidden = true; $("judgeCard").hidden = true;
    } else {
      const m = last.mine;
      $("setAmtCard").hidden = false; $("setCard").hidden = false;
      $("setH1").textContent = `${last.round}회차 정산 완료`;
      $("setSub").textContent = !m ? "스터디원별 결과예요" : m.got > 0n ? `${ATT[m.status]} · ${fmt(m.got)} SDT가 적립됐어요` : `${ATT[m.status]} · 이번 회차 몫은 정시 출석자에게 나눠졌어요`;
      $("setChips").innerHTML = [[1, "출석", "ok"], [2, "지각", "warn"], [3, "결석", "warn"], [4, "공결", "blue"]].filter(([k]) => last.count[k]).map(([k, t, c]) => `<span class="chip ${c}">${t} ${last.count[k]}명</span>`).join("");
      $("setMine").textContent = m ? fmt(m.got) : "-";
      $("setRefund").textContent = m ? fmt(m.refund) : "-";
      $("setShareLabel").textContent = last.present ? `결석 분배 (${fmt(last.rd.pool)} ÷ ${last.present}명)` : "결석 분배 (정시 출석자 없음 · 이월)";
      $("setShare").textContent = m ? `+${fmt(m.share)}` : "-";
      $("setRemain").textContent = fmt(carry);
      $("sbtBadge").hidden = !(m && (m.status === 1 || m.status === 2 || m.status === 4));
      $("sbtBadgeText").textContent = `출석 SBT 발행 · 내 지갑에 ${sbtBal}개`;
      $("judgeCard").hidden = false;
      $("judgeList").innerHTML = last.rows.map(x => `<li class="li">${av(x.i, x.status === 3)}<span class="who">${nm(x.i)}${x.i === S.myIdx ? ' <span class="me-tag">· 나</span>' : ""}<small>확인 ${x.attestCount}</small></span><span class="chip sm ${ATT_CLS[x.status]}">${ATT[x.status]}</span><span class="r wide ${x.got > 0n ? "ok" : ""}">${x.got > 0n ? "+" + fmt(x.got) : "0"}</span></li>`).join("");
    }
    const active = st === ST_ACTIVE;
    if (!active) {
      $("nextTitle").textContent = st === ST_FINAL ? "스터디가 끝났어요" : st === ST_CANCELLED ? "스터디가 취소됐어요" : st === ST_NONE ? "아직 등록 전이에요" : "아직 시작 전이에요";
      $("nextDesc").textContent = st === ST_NONE ? "스터디원 6명을 등록하면 예치가 열려요." : st === ST_CREATED ? "전원이 예치하면 스터디가 시작돼요." : bal > 0n ? "돌려받을 금액을 인출할 수 있어요." : "돌려받을 금액이 없어요.";
    } else if (r === 0 || rd.settled) {
      if (r < rounds) { $("nextTitle").textContent = `${r + 1}회차를 열 수 있어요`; $("nextDesc").textContent = `모듈 ${r + 1} · ${MODULES[r + 1] || ""}. 제출 마감과 확인 마감은 아래에서 정해요.`; }
      else { $("nextTitle").textContent = "최종 정산만 남았어요"; $("nextDesc").textContent = `마지막 정산 ${cfg.finalizeDelay / 86400}일 뒤에 개근 배지를 주고, 남은 잔액을 개근자(없으면 전원)에게 나눠요.`; }
    } else {
      $("nextTitle").textContent = `${r}회차 진행 중`;
      $("nextDesc").textContent = phase === 4 ? "정산 가능 시각이 지났어요. 정산하면 금액이 적립되고 출석·지각 배지가 발행돼요. 토큰은 홈에서 인출해요." : `정산 가능 ${ts(readyAt)} · ${remain(readyAt, now)}`;
    }
    document.querySelector('.tabs [data-tab="settle"] .dot').classList.toggle("on", connected && active && r > 0 && rd && !rd.settled && phase === 4);
  }

  let voteYes = 2;
  function renderVote() {
    $("voteYes").textContent = voteYes;
    $("voteBar").innerHTML = Array.from({ length: 4 }, (_, i) => `<i class="${i < voteYes ? "on" : ""}"></i>`).join("");
    $("voteSub").textContent = voteYes >= 3 ? "기준 충족 · 5회차 몫이 정시 출석으로 인정돼요" : "신청자 제외 5명 중 과반";
    $("voteOk").disabled = $("voteNo").disabled = voteYes !== 2;
  }
  $("voteOk").addEventListener("click", () => { voteYes = 3; renderVote(); });
  $("voteNo").addEventListener("click", () => { $("voteSub").textContent = "반대했어요 · 찬성 2 / 기준 3"; $("voteOk").disabled = $("voteNo").disabled = true; });

  function excusedRows() {
    const out = [];
    (S.hist || []).forEach(h => h.rows.forEach(x => { if (x.excused) out.push({ round: h.round, member: x.addr, i: x.i }); }));
    if (S.rd && !S.rd.settled && S.mrs) S.mrs.forEach((m, i) => { if (m.excused) out.push({ round: S.r, member: S.members[i], i }); });
    return out;
  }
  function renderExcuse() {
    const { members, isMember, rounds, st, proposals, now, myIdx } = S;
    const list = connected ? excusedRows() : [];
    $("voteWrap").hidden = connected;
    $("excuseList").innerHTML = list.length ? list.map(x =>
      `<li class="li">${av(x.i)}<span class="who">${nameOf(members, x.member)}<small>${x.round}회차</small></span><span class="chip sm blue">공결</span></li>`).join("")
      : emptyRow(connected ? "아직 없어요" : "연결하면 온체인 공결이 여기 보여요");
    const showForm = connected && isMember && st !== ST_NONE;
    $("excuseAdmin").hidden = !showForm;
    $("proposalCard").hidden = !connected;
    if (showForm) {
      const sel = $("excuseMember"), keep = sel.value;
      sel.innerHTML = members.map((a, i) => `<option value="${a}">${nm(i)}</option>`).join("");
      if (keep) sel.value = keep;
      $("excuseRound").max = rounds;
      syncProposalFields();
    }
    const rows = (proposals || []).slice().reverse();
    $("proposalList").innerHTML = !connected ? "" : rows.length ? rows.map(p => {
      const open = !p.executed && now < p.deadline;
      const canVote = isMember && open && !p.voted && (p.type === 2 || p.target !== myIdx);
      const canExec = !p.executed && now >= p.deadline;
      const target = members[p.target] ? nm(p.target) : short(members[p.target] || "");
      const extra = p.type === 2 ? ` → ${short(p.newWallet)}` : ` · ${p.roundId}회차`;
      const acts = p.executed ? `<span class="done">실행됨</span>` : `<span class="acts">${canVote ? `<button class="sbtn line" data-vote="0" data-id="${p.id}" type="button">반대</button><button class="sbtn" data-vote="1" data-id="${p.id}" type="button">찬성</button>` : ""}${canExec ? `<button class="sbtn" data-exec="${p.id}" type="button">실행</button>` : ""}</span>`;
      return `<li class="li"><span class="who">${PROP[p.type] || "안건"} ${p.id}<small>${target}${extra} · 찬성 ${p.yes} / 반대 ${p.no} · ${open ? remain(p.deadline, now) : p.executed ? "실행됨" : "투표 종료"}</small></span>${acts}</li>`;
    }).join("") : emptyRow("등록된 안건이 없어요");
    document.querySelectorAll("[data-vote]").forEach(b => { b.onclick = () => tx(b.dataset.vote === "1" ? "찬성" : "반대", () => escrow.vote(BigInt(b.dataset.id), b.dataset.vote === "1")); });
    document.querySelectorAll("[data-exec]").forEach(b => { b.onclick = () => tx("안건 실행", () => escrow.executeProposal(BigInt(b.dataset.id))); });
  }
  function syncProposalFields() {
    const wallet = $("proposalType")?.value === "2";
    if ($("newWalletField")) $("newWalletField").hidden = !wallet;
    if ($("excuseRoundField")) $("excuseRoundField").hidden = wallet;
  }

  function renderContracts() {
    const rows = [["에스크로", CFG?.escrow], ["SDT 토큰", CFG?.sdt], ["출석 SBT", CFG?.sbt]];
    $("contractList").innerHTML = rows.map(([label, a]) => {
      const url = a && explorer("address", a);
      const text = a || "-";
      return `<li class="li"><span class="who">${label}<small class="mono addr">${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>` : text}</small></span>${a ? `<button class="iconbtn" data-copy="${a}" type="button" aria-label="${label} 주소 복사"><svg class="ic" aria-hidden="true"><use href="#i-copy"/></svg></button>` : ""}</li>`;
    }).join("");
  }
  $("contractList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]"); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); msg("주소를 복사했어요", "ok"); }
    catch (_) { msg("복사하지 못했어요. 주소를 직접 선택해 주세요.", "err"); }
  });

  function renderActions() {
    const { st, r, rd, rounds, phase, myDep, isMember, hasProof, bal, now, depDeadline, total, sdtBal } = S;
    const active = st === ST_ACTIVE;
    const open = r > 0 && rd && !rd.settled;
    const canOpen = isMember && active && (r === 0 || (rd && rd.settled)) && r < rounds;
    const openNext = { t: `${r + 1}회차 열기`, f: openRoundFlow };
    const settle = { t: `${r}회차 정산하기`, f: () => tx("회차 정산", () => escrow.settleRound()) };
    const finalize = { t: "최종 정산하기", f: () => tx("최종 정산", () => escrow.finalizeStudy()) };
    const A = {};
    if (st === ST_NONE) A.home = { t: "스터디 등록하러 가기", f: () => go("deposit") };
    else if (!isMember) A.home = { t: "스터디원 지갑으로 바꾸기", f: openSheet };
    else if (st === ST_CREATED && !myDep) A.home = { t: "보증금 예치하러 가기", f: () => go("deposit") };
    else if (st === ST_CREATED) A.home = { t: "다른 스터디원 예치를 기다리는 중", dis: true };
    else if (active && open && phase <= 2 && !hasProof) A.home = { t: "학습 증빙 제출", f: () => go("proof") };
    else if (active && open && phase <= 3) A.home = { t: "스터디원 증빙 확인하기", f: () => go("attest") };
    else if (active && open && phase === 4) A.home = settle;
    else if (active && r < rounds) A.home = openNext;
    else if (active) A.home = finalize;
    else if (bal > 0n) A.home = { t: `${fmt(bal)} SDT 인출하기`, f: () => tx("인출", () => escrow.withdraw()) };
    else A.home = { t: "끝났어요", dis: true };

    if (st === ST_NONE) A.deposit = { t: "스터디원 6명을 등록하기", f: createFlow };
    else if (st !== ST_CREATED) A.deposit = { t: "예치가 끝났어요", dis: true };
    else if (!isMember) A.deposit = { t: "스터디원 지갑만 예치할 수 있어요", dis: true };
    else if (myDep) A.deposit = { t: "예치 완료", dis: true };
    else if (now > depDeadline) A.deposit = { t: "예치 기한이 지났어요", dis: true };
    else if (sdtBal < total) A.deposit = { t: `SDT가 ${fmt(total - sdtBal)} 부족해요 · 테스트 SDT 받기`, f: faucet, ghost: true };
    else A.deposit = { t: "지갑으로 예치하기", f: depositFlow };

    if (!open || !isMember) A.proof = { t: "지금은 낼 증빙이 없어요", dis: true };
    else if (hasProof) A.proof = { t: "제출 완료 · 확인하러 가기", ghost: true, f: () => go("attest") };
    else if (phase > 2) A.proof = { t: "제출 기간이 끝났어요", dis: true };
    else A.proof = { t: phase === 2 ? "지각으로 증빙 제출" : "증빙 제출", dis: !(steps.s1 && steps.s2 && pendingHash), f: () => tx("증빙 제출", () => escrow.submitProof(pendingHash)) };

    if (!active) A.settle = { t: bal > 0n ? `${fmt(bal)} SDT 인출하기` : "정산이 끝났어요", dis: bal === 0n, f: () => tx("인출", () => escrow.withdraw()) };
    else if (open && phase === 4) A.settle = settle;
    else if (open) A.settle = { t: "정산 가능 시각 뒤에 정산할 수 있어요", dis: true };
    else if (r < rounds) A.settle = canOpen ? openNext : { t: "스터디원만 회차를 열 수 있어요", dis: true };
    else A.settle = finalize;

    for (const [tab, a] of Object.entries(A)) {
      const b = document.querySelector(`[data-slot="${tab}"]`);
      const flush = b.classList.contains("flush");
      b.textContent = a.t; b.disabled = !!a.dis;
      b.className = "btn" + (flush ? " flush" : "") + (a.ghost ? " ghost" : "");
      actions[tab] = a.f || null;
    }
    const dot = (tab, on) => document.querySelector(`.tabs [data-tab="${tab}"] .dot`)?.classList.toggle("on", !!on);
    dot("home", false);
    dot("proof", connected && isMember && open && phase <= 2 && !hasProof);
    dot("deposit", connected && ((st === ST_NONE) || (isMember && st === ST_CREATED && !myDep)));
    dot("attest", connected && isMember && open && phase <= 3 && (S.mrs || []).some((x, i) => i !== S.myIdx && x.proofHash !== ethers.ZeroHash && !S.attestedByMe[i]));
    if ($("openRoundFields")) {
      $("openRoundFields").hidden = !(connected && canOpen);
      $("openRoundHint").hidden = !(connected && canOpen);
    }
    const canDispute = connected && isMember && open && !rd.disputeOpen && now <= Number(rd.attestDeadline);
    if ($("btnDispute")) $("btnDispute").hidden = !canDispute;
  }
  document.querySelectorAll("[data-slot]").forEach(b => b.addEventListener("click", () => { const f = actions[b.dataset.slot]; if (f) f(); }));

  const faucet = () => tx("테스트 SDT 받기", () => sdt.faucet());
  async function depositFlow() {
    if (!connected) return tx("예치");
    const { allowance, total } = S;
    if (allowance < total) {
      const ok = await tx("SDT 사용 승인 (1/2)", () => sdt.approve(CFG.escrow, total));
      if (!ok) return;
    }
    await tx("보증금 예치 (2/2)", () => escrow.deposit());
  }
  async function createFlow() {
    if (!connected) return tx("스터디 등록");
    const raw = [0, 1, 2, 3, 4, 5].map(i => $(`roster${i}`)?.value.trim());
    let addrs;
    try { addrs = raw.map(a => ethers.getAddress(a)); }
    catch (_) { msg("지갑 주소 6개를 모두 확인해 주세요.", "err"); return; }
    if (new Set(addrs.map(a => a.toLowerCase())).size !== 6) { msg("서로 다른 지갑 6개가 필요해요.", "err"); return; }
    await tx("스터디 등록", () => escrow.createStudy(addrs));
  }
  function openRoundFlow() {
    if (!connected) return tx("회차 열기");
    const submit = unixFromLocal("submitDeadline");
    const attest = unixFromLocal("attestDeadline");
    if (!(submit > S.now && attest > submit)) {
      msg("마감 시각을 다시 정해 주세요. 제출 마감은 지금보다 뒤, 확인 마감은 제출 마감보다 뒤여야 해요.", "err");
      go("settle");
      return;
    }
    return tx("회차 열기", () => escrow.openRound(submit, attest));
  }
  function proposeFlow() {
    if (!connected) return tx("안건 등록");
    const type = Number($("proposalType").value);
    const target = $("excuseMember").value;
    let roundId = type === 2 ? 0 : Number($("excuseRound").value);
    let newWallet = ethers.ZeroAddress;
    if (type === 2) {
      try { newWallet = ethers.getAddress($("newWallet").value.trim()); }
      catch (_) { msg("새 지갑 주소를 확인해 주세요.", "err"); return; }
    }
    return tx("안건 등록", () => escrow.propose(type, target, newWallet, roundId));
  }

  $("btnFaucet").addEventListener("click", faucet);
  $("btnCreate").addEventListener("click", createFlow);
  $("btnCancel").addEventListener("click", () => tx("스터디 취소·환불", () => escrow.cancelStudy()));
  $("btnWithdraw").addEventListener("click", () => tx("인출", () => escrow.withdraw()));
  $("btnExcuse").addEventListener("click", proposeFlow);
  $("btnDispute").addEventListener("click", () => tx("이의 제기", () => escrow.raiseDispute()));
  $("proposalType").addEventListener("change", syncProposalFields);
  $("step1").addEventListener("click", () => { steps.s1 = !steps.s1; renderProof(); renderActions(); });
  $("step2").addEventListener("click", () => { steps.s2 = !steps.s2; renderProof(); renderActions(); });
  $("proofFile").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    pendingHash = await sha256File(f);
    pendingFile = f.name; pendingAt = Math.floor(Date.now() / 1000);
    renderProof(); renderActions();
  });
  $("verifyFile").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = "";
    if (!f || !verifyTarget) return;
    const i = S.members.findIndex(a => same(a, verifyTarget));
    const ok = (await sha256File(f)) === S.mrs[i].proofHash;
    verified[`${S.r}:${verifyTarget}`] = ok;
    msg(ok ? `${nm(i)}가 제출한 해시와 같은 파일이에요.` : `${nm(i)}가 제출한 해시와 달라요. 같은 원본인지 확인해 주세요.`, ok ? "ok" : "err");
    renderAttest();
  });
  document.querySelectorAll("[data-ff]").forEach(b => { b.onclick = async () => {
    try {
      await provider.send("evm_increaseTime", [Number(b.dataset.ff)]);
      await provider.send("evm_mine", []);
      msg(`체인 시각을 ${b.textContent} 앞당겼어요`, "ok");
      await refresh();
    } catch (e) { msg("시간 조작 실패: " + explain(e), "err"); }
  }; });
  document.querySelectorAll("[data-sc]").forEach(b => { b.onclick = () => {
    scenario = b.dataset.sc; pendingHash = pendingFile = pendingAt = null; steps.s1 = steps.s2 = false; verified = {};
    enterSample();
  }; });

  function show(tab, focus) {
    if (!TABS.includes(tab)) tab = "home";
    document.querySelectorAll(".tabs a").forEach(a => {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    let heading = null;
    document.querySelectorAll("section[data-screen]").forEach(s => {
      s.hidden = s.dataset.screen !== tab;
      if (!s.hidden) heading = s.querySelector("h2");
    });
    window.scrollTo({ top: 0 });
    if (focus && heading) heading.focus({ preventScroll: true });
  }
  function go(tab) {
    if (location.hash === "#" + tab) show(tab, true); else location.hash = tab;
  }
  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (TABS.includes(id)) show(id, true);
    else if (id !== "main") show("home", true);
  });

  setupRoster();
  setupSheet();
  renderVote();
  enterSample();
  show(location.hash.slice(1), false);
  (async () => {
    let wanted = false;
    try { wanted = localStorage.getItem("ae.wallet") === "1"; } catch (_) { /* 저장 불가 */ }
    if (!wanted || !canWallet || !window.ethereum) return;
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts.length) { $("mode").value = "metamask"; await connect(); }
    } catch (e) { console.error(e); }
  })();
})();
