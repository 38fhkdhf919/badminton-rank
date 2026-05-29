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

// 관리자 모드 제어 핵심 마스터 전역 변수
let isAdminMode = false;
const MASTER_PASSWORD = "1234";

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
// 🎲 4중 필터 1사이클 홀딩 배드민턴 매칭 엔진
// ==========================================
function generateAutoBalancedMatch(courtIdx) {
    const attendeesIds = currentActiveSession.attendees || [];
    const injuredList = currentActiveSession.injuredPlayers || [];
    const historyLog = currentActiveSession.historyLog || []; 
    const totalCourtsCount = currentActiveSession.courts || 1;

    const activePlayingIds = new Set();
    if (currentActiveSession && currentActiveSession.matches) {
        currentActiveSession.matches.forEach(m => {
            if (m && m.status === "LIVE") {
                m.teamA.forEach(id => activePlayingIds.add(id));
                m.teamB.forEach(id => activePlayingIds.add(id));
            }
        });
    }

    let waitingPool = allSystemPlayers.filter(p => attendeesIds.includes(p.id) && !activePlayingIds.has(p.id) && !injuredList.includes(p.id));
    if (waitingPool.length < 4) {
        waitingPool = allSystemPlayers.filter(p => attendeesIds.includes(p.id) && !injuredList.includes(p.id));
    }

    waitingPool.sort((a, b) => {
        const statsA = sessionMmrStatsMap[a.id] || { win: 0, lose: 0 };
        const statsB = sessionMmrStatsMap[b.id] || { win: 0, lose: 0 };
        const playedA = statsA.win + statsA.lose;
        const playedB = statsB.win + statsB.lose;
        if (playedA !== playedB) return playedA - playedB;
        return b.id - a.id;
    });

    const getAdjustedMmr = (p) => {
        const stats = sessionMmrStatsMap[p.id] || { win: 0, lose: 0 };
        const total = stats.win + stats.lose;
        if (total === 0) return p.matchMmr;
        const winRate = stats.win / total;
        if (winRate >= 0.6) return p.matchMmr + 70;
        if (winRate <= 0.4) return Math.max(600, p.matchMmr - 70);
        return p.matchMmr;
    };

    let bestFour = [];
    let foundPerfectMatch = false;
    const masterLeader = waitingPool[0];
    const candidates = waitingPool.slice(1);
    const lastMatch = historyLog.length > 0 ? historyLog[historyLog.length - 1] : null;
    const directPastIds = lastMatch ? [...lastMatch.teamA, ...lastMatch.teamB] : [];

    for (let i = 0; i < candidates.length - 2; i++) {
        for (let j = i + 1; j < candidates.length - 1; j++) {
            for (let k = j + 1; k < candidates.length; k++) {
                const p2 = candidates[i]; const p3 = candidates[j]; const p4 = candidates[k];
                const combo = [masterLeader, p2, p3, p4];

                let hasRecentOverlap = false;
                if (lastMatch && directPastIds.includes(masterLeader.id)) {
                    const overlapCount = combo.filter(p => directPastIds.includes(p.id)).length;
                    if (overlapCount >= 2) hasRecentOverlap = true;
                }

                const mmrs = combo.map(p => getAdjustedMmr(p));
                const maxMmr = Math.max(...mmrs); const minMmr = Math.min(...mmrs);
                const mmrGap = maxMmr - minMmr;

                if (!hasRecentOverlap && mmrGap <= 320) {
                    bestFour = combo; foundPerfectMatch = true; break;
                }
            }
            if (foundPerfectMatch) break;
        }
        if (foundPerfectMatch) break;
    }

    if (!foundPerfectMatch) {
        if (!currentActiveSession.holdCountMap) currentActiveSession.holdCountMap = {};
        const currentHold = currentActiveSession.holdCountMap[masterLeader.id] || 0;

        if (currentHold < totalCourtsCount && waitingPool.length > 4) {
            currentActiveSession.holdCountMap[masterLeader.id] = currentHold + 1;
            const alternativePool = waitingPool.slice(1);
            if (alternativePool.length >= 4) bestFour = alternativePool.slice(0, 4);
            else bestFour = waitingPool.slice(0, 4);
        } else {
            if (currentActiveSession.holdCountMap) currentActiveSession.holdCountMap[masterLeader.id] = 0;
            bestFour = waitingPool.slice(0, 4);
        }
    } else {
        if (currentActiveSession.holdCountMap && currentActiveSession.holdCountMap[masterLeader.id]) currentActiveSession.holdCountMap[masterLeader.id] = 0;
    }

    while (bestFour.length < 4) { bestFour.push({ id: 99, name: "대기회원", matchMmr: 1000, displayMmr: 1000 }); }
    bestFour.sort((a, b) => getAdjustedMmr(b) - getAdjustedMmr(a));
    
    const teamA = [bestFour[0].id, bestFour[3].id];
    const teamANames = [bestFour[0].name, bestFour[3].name];
    const teamB = [bestFour[1].id, bestFour[2].id];
    const teamBNames = [bestFour[1].name, bestFour[2].name];

    return { status: "LIVE", teamA, teamANames, teamB, teamBNames };
}

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
        const highlightClass = isMyMatch ? "border-amber-400 bg-amber-50/50 ring-4 ring-amber-400/10 scale-[1.01]" : "bg-white border-slate-200";

        const isTestMode = currentActiveSession.isTestMode === true;
        const testSimulateBtnHtml = (isTestMode && isSessionAdminMode)
            ? `<button data-index="${idx}" class="btn-simulate-score w-full mt-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black py-2 rounded-xl text-xs transition shadow-xs cursor-pointer">🤖 AI 가상 결과 자동 정산</button>`
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

    document.querySelectorAll('.btn-open-score').forEach(btn => {
        btn.onclick = function() { openScoreModal(parseInt(this.getAttribute('data-index'))); };
    });

    document.querySelectorAll('.btn-simulate-score').forEach(btn => {
        btn.onclick = function() { handleAiSimulationClick(parseInt(this.getAttribute('data-index'))); };
    });
}

function handleAiSimulationClick(courtIdx) {
    if (!isSessionAdminMode || !currentActiveSession) return;
    const match = currentActiveSession.matches[courtIdx];
    if (!match) return;

    const getAdjustedMmr = (id) => {
        const player = allSystemPlayers.find(p => p.id === id);
        if (!player) return 1000;
        const stats = sessionMmrStatsMap[id] || { win: 0, lose: 0 };
        const total = stats.win + stats.lose;
        if (total === 0) return player.matchMmr;
        if (stats.win / total >= 0.6) return player.matchMmr + 70;
        if (stats.win / total <= 0.4) return player.matchMmr - 70;
        return player.matchMmr;
    };

    const sumA = match.teamA.reduce((sum, id) => sum + getAdjustedMmr(id), 0);
    const sumB = match.teamB.reduce((sum, id) => sum + getAdjustedMmr(id), 0);
    let scoreA, scoreB;
    const randomFactor = Math.random();

    if ((sumA >= sumB && randomFactor > 0.2) || (sumB > sumA && randomFactor <= 0.2)) {
        scoreA = 21; scoreB = 14 + Math.floor(Math.random() * 6);
    } else {
        scoreB = 21; scoreA = 14 + Math.floor(Math.random() * 6);
    }
    processMmrMatchCalculation(courtIdx, scoreA, scoreB);
}

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
            if (!sessionMmrStatsMap[p.id]) sessionMmrStatsMap[p.id] = { win: 0, lose: 0, delta: 0 };
            if (winIds.includes(p.id)) {
                p.displayMmr += baseMmrChange; p.matchMmr += baseMmrChange;
                sessionMmrStatsMap[p.id].win += 1; sessionMmrStatsMap[p.id].delta += baseMmrChange;
            } else {
                p.displayMmr = Math.max(600, p.displayMmr - baseMmrChange); p.matchMmr = Math.max(600, p.matchMmr - baseMmrChange);
                sessionMmrStatsMap[p.id].lose += 1; sessionMmrStatsMap[p.id].delta -= baseMmrChange;
            }
        }
    });

    let historyLog = currentActiveSession.historyLog ? [...currentActiveSession.historyLog] : [];
    historyLog.push({ court: courtIdx + 1, teamA: match.teamA, teamB: match.teamB, timestamp: Date.now() });

    set(ref(db, 'players'), allSystemPlayers);
    currentActiveSession.matches[courtIdx] = generateAutoBalancedMatch(courtIdx);
    
    update(ref(db, `sessions/${targetSessionId}`), {
        matches: currentActiveSession.matches,
        statsLog: sessionMmrStatsMap,
        historyLog: historyLog,
        holdCountMap: currentActiveSession.holdCountMap || {}
    });
    document.getElementById('scoreModal').style.display = 'none';
}

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
        tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400">참가 인원이 없습니다.</td></tr>`;
        return;
    }

    tbody.innerHTML = todayPlayers.map((p, idx) => {
        const stats = sessionMmrStatsMap[p.id] || { win: 0, lose: 0, delta: 0 };
        let deltaHtml = `<span class="text-slate-400 font-bold font-mono">0</span>`;
        if (stats.delta > 0) deltaHtml = `<span class="text-emerald-600 font-extrabold font-mono">+${stats.delta}</span>`;
        if (stats.delta < 0) deltaHtml = `<span class="text-rose-600 font-extrabold font-mono">${stats.delta}</span>`;
        const isMeRow = p.name === clientSelectedMyName ? "bg-amber-50/40 font-bold border-l-4 border-amber-500" : "";
        return `<tr class="hover:bg-slate-50/60 transition-colors ${isMeRow}"><td class="py-3 px-4 text-center font-bold text-slate-400 font-mono">${idx + 1}</td><td class="py-3 px-4 font-black text-slate-800">${p.name} <span class="text-[10px] text-slate-400">(${p.tier}조)</span></td><td class="py-3 px-4 text-center font-mono">${stats.win+stats.lose}판</td><td class="py-3 px-4 text-center font-mono text-slate-500">${stats.win}승/${stats.lose}패</td><td class="py-3 px-4 text-right font-black font-mono">${p.displayMmr}</td><td class="py-3 px-4 text-right">${deltaHtml}</td></tr>`;
    }).join('');
}

function buildAdminManageLists() {
    const attendeesBox = document.getElementById('adminManageAttendeesList');
    const absenteesBox = document.getElementById('adminManageAbsenteesList');
    if (!attendeesBox || !absenteesBox || !currentActiveSession) return;

    const attendeesIds = currentActiveSession.attendees || [];
    const currentAttendees = allSystemPlayers.filter(p => attendeesIds.includes(p.id));
    attendeesBox.innerHTML = currentAttendees.map(p => `<div class="bg-white p-2 rounded-lg border flex justify-between items-center shadow-3xs"><span class="font-bold text-slate-800">${p.name}</span><button data-id="${p.id}" class="btn-admin-kick bg-rose-50 text-rose-600 font-bold px-2 py-1 rounded border border-rose-200 text-[10px]">제외</button></div>`).join('');

    const currentAbsentees = allSystemPlayers.filter(p => !attendeesIds.includes(p.id));
    absenteesBox.innerHTML = currentAbsentees.map(p => `<div class="bg-white p-2 rounded-lg border flex justify-between items-center shadow-3xs"><span class="font-medium text-slate-600">${p.name}</span><button data-id="${p.id}" class="btn-admin-invite bg-indigo-50 text-indigo-600 font-bold px-2 py-1 rounded border border-indigo-200 text-[10px]">➕ 참석</button></div>`).join('');

    document.querySelectorAll('.btn-admin-kick').forEach(btn => {
        btn.onclick = function() {
            let updatedList = (currentActiveSession.attendees || []).filter(id => id !== parseInt(this.getAttribute('data-id')));
            let updatedInjured = (currentActiveSession.injuredPlayers || []).filter(id => id !== parseInt(this.getAttribute('data-id')));
            update(ref(db, `sessions/${targetSessionId}`), { attendees: updatedList, injuredPlayers: updatedInjured });
        };
    });
    document.querySelectorAll('.btn-admin-invite').forEach(btn => {
        btn.onclick = function() {
            let updatedList = currentActiveSession.attendees ? [...currentActiveSession.attendees] : [];
            const pid = parseInt(this.getAttribute('data-id'));
            if (!updatedList.includes(pid)) updatedList.push(pid);
            update(ref(db, `sessions/${targetSessionId}`), { attendees: updatedList });
        };
    });
}

// 👤 [버그 완전 해결] 내 이름 드롭다운 동기화 그리기
function buildIdentityDropdown() {
    const select = document.getElementById('selectMyIdentity');
    if (!select) return;
    
    // 이미 노드가 다 채워져 있다면 중복 생성 스킵
    if (select.options.length <= 1) {
        allSystemPlayers.forEach(p => {
            const opt = document.createElement('option'); 
            opt.value = p.name; 
            opt.innerText = `${p.name} (${p.tier}조)`; 
            select.appendChild(opt);
        });
    }

    // 🔥 [타이밍 동기화 체인] 렌더링이 완전히 끝난 직후 로컬 스토리지 보존값 셋업 고정
    const savedName = localStorage.getItem("myClubFixedName");
    if (savedName && select.value !== savedName) {
        clientSelectedMyName = savedName;
        select.value = savedName; // 새로고침 시 강제 고정!!
        console.log(`💾 로컬 스토리지 본인 인증 영구 동기화 복원 완료: ${savedName}`);
    }

    select.onchange = function() {
        clientSelectedMyName = this.value;
        if (clientSelectedMyName) {
            localStorage.setItem("myClubFixedName", clientSelectedMyName);
        } else {
            localStorage.removeItem("myClubFixedName");
        }

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
// 🏢 대문 통합 연동 초기화 진입로
// ==========================================
window.initDashboardPage = function() {
    const sessionsRef = ref(db, 'sessions');
    onValue(sessionsRef, (snapshot) => {
        const data = snapshot.val();
        const container = document.getElementById('sessionListContainer');
        if (!container) return;
        if (!data) { container.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs bg-slate-50 border rounded-xl">개설된 정모 세션이 전혀 없습니다.</div>`; return; }
        const sessionEntries = Object.entries(data).reverse();
        
        container.innerHTML = sessionEntries.map(([id, s]) => {
            let badgeStyle = "bg-amber-50 text-amber-700 border-amber-200";
            if (s.status === "진행중") badgeStyle = "bg-emerald-50 text-emerald-700 border-emerald-200 animate-pulse";
            if (s.status === "종료") badgeStyle = "bg-indigo-50 text-indigo-700 border-indigo-200";
            const deleteButtonHtml = isAdminMode 
                ? `<button data-id="${id}" class="btn-delete-session bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-bold text-[11px] px-2.5 py-2 rounded-lg transition shadow-2xs ml-3 cursor-pointer">🗑️ 삭제</button>`
                : '';

            return `
                <div class="flex items-center justify-between bg-white border border-slate-200 p-4 rounded-xl shadow-xs hover:border-indigo-300 transition-all">
                    <a href="./session.html?id=${id}${isAdminMode ? '&admin=true' : ''}" class="block flex-1 space-y-1">
                        <div class="flex items-center gap-2">
                            <h3 class="text-sm font-black text-slate-900">${s.title}</h3>
                            <span class="text-[10px] font-bold font-sans px-1.5 py-0.2 rounded border ${badgeStyle}">${s.status}</span>
                        </div>
                        <p class="text-[11px] text-slate-400 font-mono">개설코드: ${id} • 참여인원: ${s.attendees ? s.attendees.length : 0}명 / 코트: ${s.courts || 4}개 ${s.isTestMode ? '🤖[시뮬레이션]' : ''}</p>
                    </a>
                    ${deleteButtonHtml}
                </div>
            `;
        }).join('');

        // 렌더링 루프가 끝난 뒤 현재 관리자 상태가 true면 무조건 체크박스 강제 노출 보정 유지
        const wrapper = document.getElementById('testModeWrapper');
        if (wrapper) {
            if (isAdminMode) {
                wrapper.style.display = 'flex';
                wrapper.classList.remove('hidden');
            } else {
                wrapper.style.display = 'none';
                wrapper.classList.add('hidden');
            }
        }

        document.querySelectorAll('.btn-delete-session').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                const sid = this.getAttribute('data-id');
                if (confirm(`정말 해당 정모방(${sid})을 삭제하시겠습니까?`)) {
                    remove(ref(db, `sessions/${sid}`)).then(() => { if(window.initDashboardPage) window.initDashboardPage(); });
                }
            };
        });
    });

    const form = document.getElementById('createSessionForm');
    if (form) {
        form.onsubmit = function(e) {
            e.preventDefault();
            const title = document.getElementById('newSessionTitle').value.trim();
            const checkboxTestMode = document.getElementById('checkboxTestMode');
            const isTestModeChecked = checkboxTestMode ? checkboxTestMode.checked : false;
            
            const now = new Date();
            const timeKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
            
            set(ref(db, `sessions/${timeKey}`), { 
                status: "예정", 
                title: title, 
                courts: 4, 
                isTestMode: isTestModeChecked,
                createdAt: Date.now() 
            }).then(() => {
                alert(`🎉 [${title}] 정모방이 정상 개설되었습니다!`);
                document.getElementById('newSessionTitle').value = '';
                if (checkboxTestMode) checkboxTestMode.checked = false;
            });
        };
    }

    const toggleBtn = document.getElementById('btnAdminToggle');
    if (toggleBtn) {
        toggleBtn.onclick = function() {
            const wrapper = document.getElementById('testModeWrapper');
            if (!isAdminMode) {
                const pw = prompt("🔐 관리자 마스터 비밀번호를 입력하세요:");
                if (pw === MASTER_PASSWORD) {
                    isAdminMode = true;
                    this.innerText = "🔓 관리자 모드 해제";
                    this.className = "bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-sm cursor-pointer mr-2 flex items-center gap-1";
                    alert("🔓 관리자 인증 성공!");
                    if (wrapper) {
                        wrapper.style.display = 'flex';
                        wrapper.classList.remove('hidden');
                    }
                    if(window.initDashboardPage) window.initDashboardPage();
                }
            } else {
                isAdminMode = false;
                this.innerText = "🔐 관리자 모드 인증";
                this.className = "bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 transition shadow-2xs cursor-pointer mr-2 flex items-center gap-1";
                if (wrapper) {
                    wrapper.style.display = 'none';
                    wrapper.classList.add('hidden');
                }
                if(window.initDashboardPage) window.initDashboardPage();
            }
        };
    }
};

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
        
        if (sessionData.statsLog) sessionMmrStatsMap = sessionData.statsLog;
        else sessionMmrStatsMap = {};

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
        buildIdentityDropdown(); // 🌟 옵션 정보 수급 완료 후 고정 아이디 트랙 강제 복원 유도
        if (currentActiveSession && currentActiveSession.status === "진행중") {
            buildSessionLiveRankTable();
            buildAdminManageLists(); 
        }
    });

    setupSessionEventListeners();
};
