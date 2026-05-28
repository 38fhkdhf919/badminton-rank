import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ⚠️ 관리자님의 실제 파이어베이스 주소 및 키값을 정확히 유지해 주세요!
const firebaseConfig = {
    apiKey: "AIzaSyDOO3yMqRlzMgnoacdaT5kuNcJKQYC-8zQ",
    authDomain: "badminton-live-rank.firebaseapp.com",
    databaseURL: "https://badminton-live-rank-default-rtdb.asia-southeast1.firebasedatabase.app", 
    projectId: "badminton-live-rank",
    storageBucket: "badminton-live-rank.firebasestorage.app",
    messagingSenderId: "803402263930",
    appId: "1:803402263930:web:ebe85b833a86d6acd33ac3",
    measurementId: "G-SE2PTKXVDJ"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 전역 캐시 변수들
let allSystemPlayers = [];
let selectedPlayerIds = new Set();
let targetSessionId = null;       
let currentActiveSession = null;
let activeModalCourtIndex = null;

let isSessionAdminMode = false;   
let clientSelectedMyName = "";    
let sessionMmrStatsMap = {};

// ==========================================
// 🚨 화면 뷰 제어 스위처 함수 전역 선언부
// ==========================================
window.renderSessionViews = function(session) {
    const badge = document.getElementById('statusBadge');
    const title = document.getElementById('sessionTitle');
    const vReady = document.getElementById('viewReady');
    const vLive = document.getElementById('viewLive');
    const vArchive = document.getElementById('viewArchive');
    if (!badge || !title || !vReady || !vLive || !vArchive) return;

    const finalTitle = session.title || "일요일 공식 정모 리그전";
    title.innerText = `📅 ${finalTitle}`;
    if (document.getElementById('liveSessionNameDisplay')) document.getElementById('liveSessionNameDisplay').innerText = `🏆 현재 진행 중인 세션 : ${finalTitle}`;
    if (document.getElementById('archiveSessionNameDisplay')) document.getElementById('archiveSessionNameDisplay').innerText = `📁 정모 공식 명칭 : ${finalTitle}`;

    vReady.style.display = 'none';
    vLive.style.display = 'none';
    vArchive.style.display = 'none';

    if (session.status === "진행중") {
        badge.innerText = "🔥 라이브 진행 중";
        badge.className = "text-xs font-bold px-2.5 py-1 rounded border font-sans bg-emerald-50 text-emerald-700 border-emerald-200";
        vLive.style.display = 'grid';
    } else if (session.status === "종료") {
        badge.innerText = "📝 정모 마감 완료";
        badge.className = "text-xs font-bold px-2.5 py-1 rounded border font-sans bg-indigo-50 text-indigo-700 border-indigo-200";
        vArchive.style.display = 'block';
    } else {
        badge.innerText = "⏳ 정모 대기중 (예정)";
        badge.className = "text-xs font-bold px-2.5 py-1 rounded border font-sans bg-amber-50 text-amber-700 border-amber-200";
        vReady.style.display = 'grid';
    }
};

// ==========================================
// 🚀 [기획 이식 핵심] 관리자 표 다중 스탯 스캔 + 1사이클 홀딩 알고리즘
// ==========================================
function generateAutoBalancedMatch(courtIdx) {
    const attendeesIds = currentActiveSession.attendees || [];
    const injuredList = currentActiveSession.injuredPlayers || [];
    const historyLog = currentActiveSession.historyLog || []; // 역대 경기 이력 배열 트랙 데이터
    const totalCourtsCount = currentActiveSession.courts || 1;

    // 1. 현재 모든 코트 위에서 게임을 뛰고 있는 선수 ID 수집 (중복 진입 원천 차단)
    const activePlayingIds = new Set();
    if (currentActiveSession && currentActiveSession.matches) {
        currentActiveSession.matches.forEach(m => {
            if (m && m.status === "LIVE") {
                m.teamA.forEach(id => activePlayingIds.add(id));
                m.teamB.forEach(id => activePlayingIds.add(id));
            }
        });
    }

    // 2. 1차 대기열 필터링 및 점수 기반 정렬 (줄 세우기)
    // 오늘 참여자 중 현재 뛰고 있지 않고 부상자가 아닌 '찐 대기자' 수집
    let waitingPool = allSystemPlayers.filter(p => attendeesIds.includes(p.id) && !activePlayingIds.has(p.id) && !injuredList.includes(p.id));

    if (waitingPool.length < 4) {
        // 도저히 인원이 안 되면 전체 참여자 풀에서 부상자만 빼고 강제 차출
        waitingPool = allSystemPlayers.filter(p => attendeesIds.includes(p.id) && !injuredList.includes(p.id));
    }

    // 🔥 [정렬 규칙] 오늘 게임 판수가 적은 사람 우선 ➔ 쉰 지 오래된 사람 (ID 역순 등으로 간접 정렬 보정)
    waitingPool.sort((a, b) => {
        const statsA = sessionMmrStatsMap[a.id] || { win: 0, lose: 0, delta: 0 };
        const statsB = sessionMmrStatsMap[b.id] || { win: 0, lose: 0, delta: 0 };
        const playedA = statsA.win + statsA.lose;
        const playedB = statsB.win + statsB.lose;
        
        if (playedA !== playedB) return playedA - playedB; // 1순위: 판수 적은 사람 우선
        return b.id - a.id; // 2순위: 셔플 분배용
    });

    // 3. 최근 승률 단기 페이스를 기반으로 보정된 보이지 않는 '매칭용 임시 MMR' 산정
    const getAdjustedMmr = (p) => {
        const stats = sessionMmrStatsMap[p.id] || { win: 0, lose: 0, delta: 0 };
        const total = stats.win + stats.lose;
        if (total === 0) return p.matchMmr;
        const winRate = stats.win / total;
        
        // 최근 기세가 좋으면(승률 60% 초과) 임시 레이팅 매칭 능력치를 버프하여 상위 매치로 상향 가중치 조정
        if (winRate >= 0.6) return p.matchMmr + 70;
        if (winRate <= 0.4) return Math.max(600, p.matchMmr - 70); // 페이스 다운 시 하향 조정
        return p.matchMmr;
    };

    // 4. 대기열 위에서부터 내려가며 최적의 4인 조합 훑기 (다중 스캔 가동)
    let bestFour = [];
    let foundPerfectMatch = false;

    // 대기열 맨 앞의 최우선 순위 대기자 확정 지정
    const masterLeader = waitingPool[0];

    // 마스터 리더를 제외한 나머지 인원들 중 조합 탐색
    const candidates = waitingPool.slice(1);

    // 직전 1경기 안에서 마스터 리더와 같이 편/적으로 만났던 동반 플레이어 ID 목록 발라내기
    const lastMatch = historyLog.length > 0 ? historyLog[historyLog.length - 1] : null;
    const directPastIds = lastMatch ? [...lastMatch.teamA, ...lastMatch.teamB] : [];

    // 중첩 반복문으로 나머지 3자리 최적의 파트너 매칭 조합 스캔
    for (let i = 0; i < candidates.length - 2; i++) {
        for (let j = i + 1; j < candidates.length - 1; j++) {
            for (let k = j + 1; k < candidates.length; k++) {
                const p2 = candidates[i];
                const p3 = candidates[j];
                const p4 = candidates[k];
                const combo = [masterLeader, p2, p3, p4];

                // 필터 A: 직전 1경기를 같이 게임한 플레이어가 겹치는지 체크
                let hasRecentOverlap = false;
                if (lastMatch && directPastIds.includes(masterLeader.id)) {
                    // 리더가 직전 판을 뛰었다면, 같이 뛰었던 사람이 이 조합에 포함되어 있는지 검증
                    const overlapCount = combo.filter(p => directPastIds.includes(p.id)).length;
                    if (overlapCount >= 2) hasRecentOverlap = true; // 2명 이상 중복 시 리벤지 중복 매치 차단
                }

                // 필터 B: 4명의 보정 MMR 실력 편차 검증 (고수와 초심의 대참사 갭 방어)
                const mmrs = combo.map(p => getAdjustedMmr(p));
                const maxMmr = Math.max(...mmrs);
                const minMmr = Math.min(...mmrs);
                const mmrGap = maxMmr - minMmr;

                // 실력차가 적당하고 직전 경기 중복이 아니면 황금 대진 조합으로 즉시 선택 낙점!
                if (!hasRecentOverlap && mmrGap <= 320) {
                    bestFour = combo;
                    foundPerfectMatch = true;
                    break;
                }
            }
            if (foundPerfectMatch) break;
        }
        if (foundPerfectMatch) break;
    }

    // 5. 🛑 [기획의 핵심] 1사이클 조건부 홀딩 예약 제어 로직 가동
    // 만약 완벽한 조건의 4인이 안 튀어나왔을 때, 의도적으로 홀딩
    if (!foundPerfectMatch) {
        // 현재 이 방에 누적된 홀딩 카운트 스캔 (없으면 기화)
        if (!currentActiveSession.holdCountMap) currentActiveSession.holdCountMap = {};
        const currentHold = currentActiveSession.holdCountMap[masterLeader.id] || 0;

        // 홀딩 한계선 마지노선: 최대 1사이클 (현재 돌아가는 코트 개수만큼 경기수가 지나갈 때까지)
        if (currentHold < totalCourtsCount && waitingPool.length > 4) {
            console.log(`⏳ 홀딩 발동: [${masterLeader.name}] 회원의 최우선 대진 상대를 찾기 위해 1경기 대기 홀딩 락을 겁니다. (현재 ${currentHold}/${totalCourtsCount} 사이클 대기 중)`);
            
            // 카운트 1 올리고 서버 저장
            currentActiveSession.holdCountMap[masterLeader.id] = currentHold + 1;
            
            // 이번 턴은 리더를 건너뛰고, 대기열 다음 순번의 4명으로 우회해서 임시 대진을 짜 줍니다.
            const alternativePool = waitingPool.slice(1);
            if (alternativePool.length >= 4) {
                bestFour = alternativePool.slice(0, 4);
            } else {
                bestFour = waitingPool.slice(0, 4); // 정 인원이 없으면 홀딩 해제하고 즉시 출전
            }
        } else {
            // 1사이클 마지노선이 끝났거나 인원이 한정되어 더 뺄 사람이 없다면 강제 잠금 해제하여 출전 처리
            if (currentActiveSession.holdCountMap) {
                currentActiveSession.holdCountMap[masterLeader.id] = 0; // 카운트 리셋
            }
            bestFour = waitingPool.slice(0, 4);
        }
    } else {
        // 황금 조합을 찾았다면 홀딩 맵 초기화
        if (currentActiveSession.holdCountMap && currentActiveSession.holdCountMap[masterLeader.id]) {
            currentActiveSession.holdCountMap[masterLeader.id] = 0;
        }
    }

    // 최소 인원 4명 더미 충원 방어선
    while (bestFour.length < 4) {
        bestFour.push({ id: 99, name: "대기회원", matchMmr: 1000, displayMmr: 1000 });
    }

    // 6. 확정된 최종 4인 내부에서 점수 합이 가장 팽팽한 팀 반분(팀 찢기) 밸런싱 실행
    bestFour.sort((a, b) => getAdjustedMmr(b) - getAdjustedMmr(a)); // 보정 레이팅 높은 순 정렬
    
    // 1등+4등(고수+초심) vs 2등+3등(중수+중수) 팀 스와핑 찢기 기법 적용
    const teamA = [bestFour[0].id, bestFour[3].id];
    const teamANames = [bestFour[0].name, bestFour[3].name];
    const teamB = [bestFour[1].id, bestFour[2].id];
    const teamBNames = [bestFour[1].name, bestFour[2].name];

    return {
        status: "LIVE",
        teamA, teamANames,
        teamB, teamBNames
    };
}

// 🏟️ 실시간 코트 대진표 출력 및 내 경기 하이라이트 매핑
// 🏟️ 실시간 코트 대진표 출력 및 내 경기 하이라이트 매핑 (테스트 모드 지원 버전)
function buildLiveCourtsDisplay() {
    const container = document.getElementById('courtsContainer');
    if (!container || !currentActiveSession || !targetSessionId) return;

    const totalCourtsCount = currentActiveSession.courts || 1;
    if (!currentActiveSession.matches) {
        currentActiveSession.matches = [];
        for (let i = 0; i < totalCourtsCount; i++) { currentActiveSession.matches.push(generateAutoBalancedMatch(i)); }
        set(ref(db, `sessions/${targetSessionId}/matches`), currentActiveSession.matches);
        return;
    }

    container.innerHTML = currentActiveSession.matches.map((m, idx) => {
        if (!m) return '';
        const isMyMatch = m.teamANames.includes(clientSelectedMyName) || m.teamBNames.includes(clientSelectedMyName);
        const highlightClass = isMyMatch 
            ? "border-amber-400 bg-amber-50/50 ring-4 ring-amber-400/10 scale-[1.01]" 
            : "bg-white border-slate-200";

        // 🔥 [테스트 모드 체크] 세션이 테스트모드이고 관리자일 때만 시뮬레이션 버튼 활성화
        const isTestMode = currentActiveSession.isTestMode === true;
        const testSimulateBtnHtml = (isTestMode && isSessionAdminMode)
            ? `<button data-index="${idx}" class="btn-simulate-score w-full mt-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black py-2 rounded-xl text-xs transition shadow-xs cursor-pointer animate-pulse">🤖 AI 가상 결과 자동 정산</button>`
            : '';

        return `
            <div class="rounded-2xl border p-4 shadow-sm space-y-3.5 flex flex-col justify-between transition-all duration-300 ${highlightClass}">
                <div class="flex justify-between items-center border-b border-slate-100 pb-1.5">
                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-black text-indigo-600 font-mono"> Stadium COURT ${idx + 1}</span>
                        ${isMyMatch ? `<span class="bg-amber-500 text-white font-extrabold text-[9px] px-1.5 py-0.5 rounded animate-bounce shadow-2xs">🔥 내 경기!</span>` : ''}
                    </div>
                    <span class="text-[9px] bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded">MATCH LIVE</span>
                </div>
                <div class="grid grid-cols-7 gap-1 items-center justify-center py-1 text-center font-sans">
                    <div class="col-span-3 text-xs font-extrabold text-slate-800 bg-white shadow-2xs p-2.5 rounded-xl border border-slate-200/60">${m.teamANames.join(' • ')}</div>
                    <div class="col-span-1 text-[10px] font-black text-slate-300 font-mono">VS</div>
                    <div class="col-span-3 text-xs font-extrabold text-slate-800 bg-white shadow-2xs p-2.5 rounded-xl border border-slate-200/60">${m.teamBNames.join(' • ')}</div>
                </div>
                <div class="space-y-1">
                    <button data-index="${idx}" class="btn-open-score w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 rounded-xl text-xs transition shadow-xs cursor-pointer">⚖️ 스코어 수동 입력</button>
                    ${testSimulateBtnHtml}
                </div>
            </div>
        `;
    }).join('');

    // 기존 수동 입력 버튼 바인딩
    document.querySelectorAll('.btn-open-score').forEach(btn => {
        btn.onclick = function() { openScoreModal(parseInt(this.getAttribute('data-index'))); };
    });

    // 🔥 [새로 추가] AI 자동 시뮬레이션 버튼 이벤트 바인딩
    document.querySelectorAll('.btn-simulate-score').forEach(btn => {
        btn.onclick = function() {
            const courtIdx = parseInt(this.getAttribute('data-index'));
            handleAiSimulationClick(courtIdx);
        };
    });
}

// 🔥 [테스트 모드 전용] AI 가상 스코어 자동 연산 및 즉시 정산기
function handleAiSimulationClick(courtIdx) {
    if (!isSessionAdminMode || !currentActiveSession) return;
    const match = currentActiveSession.matches[courtIdx];
    if (!match) return;

    // 두 팀의 현재 MMR 합산 계산 (실력 척도)
    const getAdjustedMmr = (id) => {
        const player = allSystemPlayers.find(p => p.id === id);
        if (!player) return 1000;
        const stats = sessionMmrStatsMap[id] || { win: 0, lose: 0 };
        const total = stats.win + stats.lose;
        if (total === 0) return player.matchMmr;
        const winRate = stats.win / total;
        if (winRate >= 0.6) return player.matchMmr + 70;
        if (winRate <= 0.4) return player.matchMmr - 70;
        return player.matchMmr;
    };

    const sumA = match.teamA.reduce((sum, id) => sum + getAdjustedMmr(id), 0);
    const sumB = match.teamB.reduce((sum, id) => sum + getAdjustedMmr(id), 0);

    let scoreA, scoreB;
    const randomFactor = Math.random(); // 0.0 ~ 1.0 랜덤값

    // 기본적으로 MMR 합이 높은 팀이 이길 확률 80%, 이변이 일어날 확률 20%
    if ((sumA >= sumB && randomFactor > 0.2) || (sumB > sumA && randomFactor <= 0.2)) {
        // A팀 승리
        scoreA = 21;
        scoreB = 15 + Math.floor(Math.random() * 5); // 15 ~ 19점 사이로 패배 (접전)
    } else {
        // B팀 승리
        scoreB = 21;
        scoreA = 15 + Math.floor(Math.random() * 5); // 15 ~ 19점 사이로 패배
    }

    console.log(`🤖 [시뮬레이터] 코트 ${courtIdx + 1} 결과 생성 -> 팀A(${match.teamANames.join(',')}) [${scoreA} : ${scoreB}] 팀B(${match.teamBNames.join(',')})`);
    
    // 기존에 만들어둔 정산 메커니즘에 가상 스코어를 다이렉트로 주입
    processMmrMatchCalculation(courtIdx, scoreA, scoreB);
}

// 경기 결과 처리 점수 연산
function processMmrMatchCalculation(courtIdx, scoreA, scoreB) {
    if (!isSessionAdminMode) { alert("권한 거부"); return; }
    if (!targetSessionId) return;
    const match = currentActiveSession.matches[courtIdx];
    const scoreDiff = Math.abs(scoreA - scoreB);
    const bonusWeight = Math.min(5, Math.floor(scoreDiff / 3));
    const baseMmrChange = 15 + bonusWeight;

    const winnerTeam = scoreA > scoreB ? 'A' : 'B';
    const winIds = winnerTeam === 'A' ? match.teamA : match.teamB;
    const loseIds = winnerTeam === 'A' ? match.teamB : match.teamA;

    allSystemPlayers.forEach(p => {
        if (winIds.includes(p.id) || loseIds.includes(p.id)) {
            p.matchesPlayed += 1;
            if (!sessionMmrStatsMap[p.id]) {
                sessionMmrStatsMap[p.id] = { win: 0, lose: 0, delta: 0 };
            }
            if (winIds.includes(p.id)) {
                p.displayMmr += baseMmrChange; p.matchMmr += baseMmrChange;
                sessionMmrStatsMap[p.id].win += 1;
                sessionMmrStatsMap[p.id].delta += baseMmrChange;
            } else {
                p.displayMmr = Math.max(600, p.displayMmr - baseMmrChange); p.matchMmr = Math.max(600, p.matchMmr - baseMmrChange);
                sessionMmrStatsMap[p.id].lose += 1;
                sessionMmrStatsMap[p.id].delta -= baseMmrChange;
            }
        }
    });

    // 경기 이력 로그 생성 (역대 리벤지 매치 중복 차단 추적용)
    let historyLog = currentActiveSession.historyLog ? [...currentActiveSession.historyLog] : [];
    historyLog.push({
        court: courtIdx + 1,
        teamA: match.teamA,
        teamB: match.teamB,
        timestamp: Date.now()
    });

    set(ref(db, 'players'), allSystemPlayers);
    
    // 다음 경기할 4인 자동 수급 연산
    currentActiveSession.matches[courtIdx] = generateAutoBalancedMatch(courtIdx);
    
    update(ref(db, `sessions/${targetSessionId}`), {
        matches: currentActiveSession.matches,
        statsLog: sessionMmrStatsMap,
        historyLog: historyLog,
        holdCountMap: currentActiveSession.holdCountMap || {}
    });

    alert(`🎉 정산 성공! 오늘의 득실 점수가 스코어보드에 실시간 가중 반영되었습니다.`);
    document.getElementById('scoreModal').style.display = 'none';
}

// 📊 실시간 당일 성적표 변동 출력부
function buildSessionLiveRankTable() {
    const tbody = document.getElementById('sessionLiveRankTableBody');
    if (!tbody || !currentActiveSession) return;

    const attendeesIds = currentActiveSession.attendees || [];
    const todayPlayers = allSystemPlayers.filter(p => attendeesIds.includes(p.id));

    todayPlayers.sort((a, b) => {
        const deltaA = sessionMmrStatsMap[a.id] ? sessionMmrStatsMap[a.id].delta : 0;
        const deltaB = sessionMmrStatsMap[b.id] ? sessionMmrStatsMap[b.id].delta : 0;
        return deltaB - deltaA;
    });

    if (todayPlayers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400">성적을 정산할 라이브 참가 인원이 없습니다.</td></tr>`;
        return;
    }

    tbody.innerHTML = todayPlayers.map((p, idx) => {
        const stats = sessionMmrStatsMap[p.id] || { win: 0, lose: 0, delta: 0 };
        const totalPlayedToday = stats.win + stats.lose;
        let deltaHtml = `<span class="text-slate-400 font-bold font-mono">0</span>`;
        if (stats.delta > 0) deltaHtml = `<span class="text-emerald-600 font-extrabold font-mono">+${stats.delta}점</span>`;
        if (stats.delta < 0) deltaHtml = `<span class="text-rose-600 font-extrabold font-mono">${stats.delta}점</span>`;
        const isMeRow = p.name === clientSelectedMyName ? "bg-amber-50/60 font-bold" : "";

        return `
            <tr class="hover:bg-slate-50/60 transition-colors ${isMeRow}">
                <td class="py-3 px-4 text-center font-bold text-slate-400 font-mono">${idx + 1}</td>
                <td class="py-3 px-4 font-black text-slate-800">${p.name} <span class="text-[10px] text-slate-400 font-normal">(${p.tier}조)</span></td>
                <td class="py-3 px-4 text-center font-mono text-slate-500">${totalPlayedToday}경기</td>
                <td class="py-3 px-4 text-center font-mono text-slate-600"><span class="text-emerald-600">${stats.win}승</span> / <span class="text-rose-500">${stats.lose}패</span></td>
                <td class="py-3 px-4 text-right font-black font-mono text-slate-900">${p.displayMmr}점</td>
                <td class="py-3 px-4 text-right">${deltaHtml}</td>
            </tr>
        `;
    }).join('');
}

function buildAdminManageLists() {
    const attendeesBox = document.getElementById('adminManageAttendeesList');
    const absenteesBox = document.getElementById('adminManageAbsenteesList');
    if (!attendeesBox || !absenteesBox || !currentActiveSession) return;

    const attendeesIds = currentActiveSession.attendees || [];
    const currentAttendees = allSystemPlayers.filter(p => attendeesIds.includes(p.id));
    attendeesBox.innerHTML = currentAttendees.map(p => `
        <div class="bg-white p-2 rounded-lg border border-slate-200 flex justify-between items-center shadow-3xs">
            <span class="font-bold text-slate-800">${p.name} <span class="text-[10px] text-slate-400 font-mono">(${p.tier}조)</span></span>
            <button data-id="${p.id}" class="btn-admin-kick bg-rose-50 text-rose-600 font-bold px-2 py-1 rounded border border-rose-200 text-[10px] cursor-pointer">제외</button>
        </div>
    `).join('');

    const currentAbsentees = allSystemPlayers.filter(p => !attendeesIds.includes(p.id));
    absenteesBox.innerHTML = currentAbsentees.map(p => `
        <div class="bg-white p-2 rounded-lg border border-slate-200 flex justify-between items-center shadow-3xs">
            <span class="font-medium text-slate-600">${p.name} <span class="text-[10px] text-slate-400 font-mono">(${p.tier}조)</span></span>
            <button data-id="${p.id}" class="btn-admin-invite bg-indigo-50 text-indigo-600 font-bold px-2 py-1 rounded border border-indigo-200 text-[10px] cursor-pointer">➕ 참석 추가</button>
        </div>
    `).join('');

    document.querySelectorAll('.btn-admin-kick').forEach(btn => {
        btn.onclick = function() {
            const pid = parseInt(this.getAttribute('data-id'));
            let updatedList = (currentActiveSession.attendees || []).filter(id => id !== pid);
            let updatedInjured = (currentActiveSession.injuredPlayers || []).filter(id => id !== pid);
            update(ref(db, `sessions/${targetSessionId}`), { attendees: updatedList, injuredPlayers: updatedInjured }).then(() => { buildAdminManageLists(); });
        };
    });

    document.querySelectorAll('.btn-admin-invite').forEach(btn => {
        btn.onclick = function() {
            const pid = parseInt(this.getAttribute('data-id'));
            let updatedList = currentActiveSession.attendees ? [...currentActiveSession.attendees] : [];
            if (!updatedList.includes(pid)) updatedList.push(pid);
            update(ref(db, `sessions/${targetSessionId}`), { attendees: updatedList }).then(() => { buildAdminManageLists(); });
        };
    });
}

function buildIdentityDropdown() {
    const select = document.getElementById('selectMyIdentity');
    if (!select || select.options.length > 1) return;
    allSystemPlayers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; opt.innerText = `${p.name} (${p.tier}조)`;
        select.appendChild(opt);
    });
    select.onchange = function() {
        clientSelectedMyName = this.value;
        if (currentActiveSession && currentActiveSession.status === "진행중") {
            buildLiveCourtsDisplay(); 
            buildLiveWaitingQueueDisplay();
            buildSessionLiveRankTable();
        }
    };
}

function buildAttendanceGrid() {
    const grid = document.getElementById('attendanceGrid');
    if (!grid || !allSystemPlayers || allSystemPlayers.length === 0) return;
    grid.innerHTML = allSystemPlayers.map(p => {
        const isChecked = selectedPlayerIds.has(p.id);
        const activeClass = isChecked ? "bg-indigo-50 border-indigo-50 text-indigo-900 ring-2 ring-indigo-600/10 font-bold" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50";
        const badgeColor = p.tier === 'A' ? 'bg-rose-50 text-rose-600 border-rose-100' : p.tier === 'B' ? 'bg-amber-50 text-amber-600 border-amber-100' : p.tier === 'C' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-sky-50 text-sky-600 border-sky-100';
        return `<div data-id="${p.id}" class="player-card p-3.5 rounded-xl border text-left cursor-pointer transition-all flex justify-between items-center shadow-xs ${activeClass}"><div class="space-y-0.5"><p class="text-[10px] text-slate-400 font-mono font-medium">ID ${String(p.id).padStart(2, '0')}</p><p class="text-xs font-bold font-sans">${p.name}</p></div><span class="text-[10px] font-sans font-bold px-2 py-0.5 rounded-md border ${badgeColor}">${p.tier}조</span></div>`;
    }).join('');
    document.querySelectorAll('.player-card').forEach(card => {
        card.onclick = function() {
            if (!isSessionAdminMode) { alert("🔒 출석체크는 관리자만 조작 가능합니다."); return; }
            const pid = parseInt(this.getAttribute('data-id'));
            if (selectedPlayerIds.has(pid)) selectedPlayerIds.delete(pid); else selectedPlayerIds.add(pid);
            const cnt = document.getElementById('checkedCount'); if (cnt) cnt.innerText = selectedPlayerIds.size;
            buildAttendanceGrid();
        };
    });
}

function buildLiveWaitingQueueDisplay() {
    const queueContainer = document.getElementById('liveWaitingContainer');
    if (!queueContainer || !currentActiveSession) return;
    const attendeesIds = currentActiveSession.attendees || [];
    const injuredList = currentActiveSession.injuredPlayers || [];
    const activePlayingIds = new Set();
    if (currentActiveSession.matches) {
        currentActiveSession.matches.forEach(m => {
            if (m && m.status === "LIVE") { m.teamA.forEach(id => activePlayingIds.add(id)); m.teamB.forEach(id => activePlayingIds.add(id)); }
        });
    }
    const attendancePlayers = allSystemPlayers.filter(p => attendeesIds.includes(p.id));
    queueContainer.innerHTML = attendancePlayers.map(p => {
        const isPlaying = activePlayingIds.has(p.id); const isInjured = injuredList.includes(p.id);
        let statusBadge = `<span class="bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-2xs">⏳ 대기중</span>`;
        if (isPlaying) statusBadge = `<span class="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[9px] px-1.5 py-0.5 rounded font-bold">🎾 경기중</span>`;
        if (isInjured) statusBadge = `<span class="bg-rose-100 text-rose-700 border border-rose-200 text-[9px] px-1.5 py-0.5 rounded font-bold">🚑 쉼/부상</span>`;
        const hasControlPermission = isSessionAdminMode || (clientSelectedMyName === p.name);
        let actionBtnHtml = "";
        if (hasControlPermission && !isPlaying) {
            actionBtnHtml = isInjured 
                ? `<button data-id="${p.id}" class="btn-toggle-injury bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-xs transition-colors cursor-pointer">복귀</button>`
                : `<button data-id="${p.id}" class="btn-toggle-injury bg-slate-100 hover:bg-rose-50 text-slate-600 border text-[10px] font-bold px-2 py-1 rounded shadow-2xs transition-colors cursor-pointer">제외</button>`;
        }
        const cardBg = isInjured ? "bg-rose-50/50 border-rose-100 opacity-80" : isPlaying ? "bg-slate-50 border-slate-200 opacity-60" : "bg-white border-slate-200";
        return `<div class="p-3 rounded-xl border flex justify-between items-center ${cardBg}"><div class="flex items-center gap-2"><div><span class="text-slate-800 font-extrabold text-xs block">${p.name} <span class="text-[10px] text-slate-400 font-mono font-normal">${p.tier}조</span></span><span class="text-[9px] font-mono text-slate-400">누적: ${p.displayMmr}점</span></div></div><div class="flex items-center gap-1.5">${statusBadge}${actionBtnHtml}</div></div>`;
    }).join('');
    document.querySelectorAll('.btn-toggle-injury').forEach(btn => {
        btn.onclick = function() {
            const pid = parseInt(this.getAttribute('data-id'));
            let currentInjured = currentActiveSession.injuredPlayers ? [...currentActiveSession.injuredPlayers] : [];
            if (currentInjured.includes(pid)) currentInjured = currentInjured.filter(id => id !== pid); else currentInjured.push(pid);
            update(ref(db, `sessions/${targetSessionId}`), { injuredPlayers: currentInjured });
        };
    });
}

function setupSessionEventListeners() {
    const btnPanelOpen = document.getElementById('btnAdminPanelToggle');
    const btnPanelClose = document.getElementById('btnCloseAdminModal');
    const adminModal = document.getElementById('adminManageModal');

    if (btnPanelOpen && adminModal) { btnPanelOpen.onclick = () => { buildAdminManageLists(); adminModal.style.display = 'flex'; }; }
    if (btnPanelClose && adminModal) { btnPanelClose.onclick = () => { adminModal.style.display = 'none'; }; }

    const btnAll = document.getElementById('btnSelectAll');
    if (btnAll) {
        btnAll.onclick = function() {
            if(!isSessionAdminMode) return;
            if (selectedPlayerIds.size === allSystemPlayers.length) selectedPlayerIds.clear();
            else allSystemPlayers.forEach(p => selectedPlayerIds.add(p.id));
            const cnt = document.getElementById('checkedCount'); if (cnt) cnt.innerText = selectedPlayerIds.size;
            buildAttendanceGrid();
        };
    }
    const btnSave = document.getElementById('btnSaveSetup');
    if (btnSave) {
        btnSave.onclick = function() {
            if(!isSessionAdminMode) return;
            if (!targetSessionId) return;
            const selectedCourts = parseInt(document.getElementById('selectCourts').value);
            const finalAttendeeList = Array.from(selectedPlayerIds);
            update(ref(db, `sessions/${targetSessionId}`), { courts: selectedCourts, attendees: finalAttendeeList }).then(() => { alert("💾 상태 보존 및 환경 설정 저장 완료!"); });
        };
    }
    const btnStart = document.getElementById('btnStartSession');
    if (btnStart) {
        btnStart.onclick = function() {
            if(!isSessionAdminMode) return;
            if (!targetSessionId) return;
            if (selectedPlayerIds.size < 4) { alert("❌ 최소 4명 이상 필요합니다!"); return; }
            const selectedCourts = parseInt(document.getElementById('selectCourts').value);
            const finalAttendeeList = Array.from(selectedPlayerIds);
            if (confirm("▶️ 라이브 모드로 전환하고 실시간 대진표를 가동하시겠습니까?")) {
                update(ref(db, `sessions/${targetSessionId}`), { status: "진행중", courts: selectedCourts, attendees: finalAttendeeList });
            }
        };
    }
    const btnCancel = document.getElementById('btnCancelModal');
    if (btnCancel) btnCancel.onclick = () => { document.getElementById('scoreModal').style.display = 'none'; };
    
    const btnSubmit = document.getElementById('btnSubmitScore');
    if (btnSubmit) {
        btnSubmit.onclick = function() {
            if(!isSessionAdminMode) return;
            const scoreA = parseInt(document.getElementById('scoreA').value) || 0;
            const scoreB = parseInt(document.getElementById('scoreB').value) || 0;
            if (scoreA === scoreB) { alert("❌ 동점 종료는 불가능합니다!"); return; }
            if (activeModalCourtIndex !== null) processMmrMatchCalculation(activeModalCourtIndex, scoreA, scoreB);
        };
    }
    const btnEnd = document.getElementById('btnEndSession');
    if (btnEnd) {
        btnEnd.onclick = function() {
            if(!isSessionAdminMode) return;
            if (!targetSessionId) return;
            if (confirm("🛑 정말 오늘 경기를 최종 종료하고 아카이브로 이관하시겠습니까?")) { update(ref(db, `sessions/${targetSessionId}`), { status: "종료" }); }
        };
    }
}

// ==========================================
// 🏢 개별 제어 마스터 바인딩 입구
// ==========================================
window.initSessionPage = function() {
    const urlParams = new URLSearchParams(window.location.search);
    targetSessionId = urlParams.get('id');
    isSessionAdminMode = urlParams.get('admin') === 'true';

    if (!targetSessionId) { window.location.href = "./index.html"; return; }

    const adminBadge = document.getElementById('adminClientBadge');
    const adminBtnGroup = document.getElementById('adminButtonGroup');
    const adminNotice = document.getElementById('adminOnlyLockNotice');
    const btnSelectAll = document.getElementById('btnSelectAll');
    const btnEndSession = document.getElementById('btnEndSession');
    const btnAdminPanelToggle = document.getElementById('btnAdminPanelToggle');

    if (isSessionAdminMode) {
        if(adminBadge) adminBadge.classList.remove('hidden');
        if(adminBtnGroup) adminBtnGroup.classList.remove('hidden');
        if(btnSelectAll) btnSelectAll.classList.remove('hidden');
        if(btnEndSession) btnEndSession.classList.remove('hidden');
        if(btnAdminPanelToggle) btnAdminPanelToggle.classList.remove('hidden');
        if(adminNotice) adminNotice.classList.add('hidden');
    }

    const specificSessionRef = ref(db, `sessions/${targetSessionId}`);
    onValue(specificSessionRef, (snapshot) => {
        let sessionData = snapshot.val();
        if (!sessionData) return;
        currentActiveSession = sessionData;
        
        if (sessionData.statsLog) {
            sessionMmrStatsMap = sessionData.statsLog;
        } else {
            sessionMmrStatsMap = {};
        }

        if (sessionData.attendees) {
            selectedPlayerIds = new Set(sessionData.attendees);
            const cnt = document.getElementById('checkedCount');
            if (cnt) cnt.innerText = selectedPlayerIds.size;
        }

        window.renderSessionViews(sessionData);
        
        if (sessionData.status === "진행중") {
            buildLiveCourtsDisplay();
            buildLiveWaitingQueueDisplay(); 
            buildSessionLiveRankTable();
        }
    });

    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            allSystemPlayers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
            allSystemPlayers.sort((a, b) => a.id - b.id);
        }
        buildAttendanceGrid();
        buildIdentityDropdown(); 
        if (currentActiveSession && currentActiveSession.status === "진행중") {
            buildSessionLiveRankTable();
            buildAdminManageLists(); 
        }
    });

    setupSessionEventListeners();
};

// 회원 명단 백오피스용 호환성 기능 유지 (players.html)
let currentCachedPlayers = [];
window.listenToPlayers = function(callback) {
    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        let playersList = [];
        if (data) playersList = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
        playersList.sort((a, b) => a.id - b.id); currentCachedPlayers = playersList;
        if (typeof callback === 'function') callback(playersList);
    });
};
window.addNewPlayerToServer = function(name, age, tier, successCallback) {
    let maxId = 0;
    if (currentCachedPlayers.length > 0) maxId = Math.max(...currentCachedPlayers.map(p => p.id));
    const nextId = maxId + 1; const targetIndex = currentCachedPlayers.length;
    const newPlayerData = { id: nextId, name, age, tier, displayMmr: 1000, matchMmr: 1000, matchesPlayed: 0, streak: 0 };
    set(ref(db, `players/${targetIndex}`), newPlayerData).then(() => { if (typeof successCallback === 'function') successCallback(); });
};
