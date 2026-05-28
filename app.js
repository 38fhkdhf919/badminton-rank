import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// 본인의 실제 파이어베이스 주소 및 키 유지
const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_AUTH_DOMAIN_HERE",
    databaseURL: "https://badminton-live-rank-default-rtdb.asia-southeast1.firebasedatabase.app", 
    projectId: "YOUR_PROJECT_ID_HERE",
    storageBucket: "YOUR_STORAGE_BUCKET_HERE",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID_HERE",
    appId: "YOUR_APP_ID_HERE"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 전역 캐시 포인터들
let allSystemPlayers = [];
let selectedPlayerIds = new Set();
let targetSessionId = null;       // 🔥 현재 추적 중인 정모의 고유 방 ID (?id= 수신값)
let currentActiveSession = null;
let activeModalCourtIndex = null;

// ==========================================
// 🏢 [신규] 대문 대시보드 (index.html) 제어 엔진
// ==========================================
window.initDashboardPage = function() {
    console.log("🏠 대시보드 스캔 가동...");
    
    // 1. 파이어베이스의 멀티 정모 데이터창고(sessions) 실시간 스캔 리스너
    const sessionsRef = ref(db, 'sessions');
    onValue(sessionsRef, (snapshot) => {
        const data = snapshot.val();
        const container = document.getElementById('sessionListContainer');
        if (!container) return;

        if (!data) {
            container.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs bg-slate-50 border rounded-xl">개설된 정모 세션이 전혀 없습니다. 왼쪽에서 일요일 첫 정모를 개설해 보세요!</div>`;
            return;
        }

        // 오브젝트를 역순(최신순) 배열로 조립
        const sessionEntries = Object.entries(data).reverse();
        
        container.innerHTML = sessionEntries.map(([id, s]) => {
            let badgeStyle = "bg-amber-50 text-amber-700 border-amber-200";
            if (s.status === "진행중") badgeStyle = "bg-emerald-50 text-emerald-700 border-emerald-200 animate-pulse";
            if (s.status === "종료") badgeStyle = "bg-indigo-50 text-indigo-700 border-indigo-200";

            return `
                <a href="./session.html?id=${id}" class="block bg-white border border-slate-200 p-4 rounded-xl shadow-xs hover:border-indigo-400 hover:shadow-md transition-all flex justify-between items-center">
                    <div class="space-y-1">
                        <h3 class="text-sm font-black text-slate-900">${s.title}</h3>
                        <p class="text-[11px] text-slate-400 font-mono">개설코드: ${id} • 설정 코트 수: ${s.courts || 4}개</p>
                    </div>
                    <span class="text-xs font-bold px-2.5 py-1 rounded border ${badgeStyle}">${s.status}</span>
                </a>
            `;
        }).join('');
    });

    // 2. 신규 정모 폼 개설 서브밋 처리
    const form = document.getElementById('createSessionForm');
    if (form) {
        form.onsubmit = function(e) {
            e.preventDefault();
            const title = document.getElementById('newSessionTitle').value.trim();
            
            // 날짜 기반 고유 문자열 ID 발급 (예: 20260528_1120)
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const date = String(now.getDate()).padStart(2, '0');
            const timeKey = `${year}${month}${date}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

            const newSessionData = {
                status: "예정",
                title: title,
                courts: 4,
                createdAt: Date.now()
            };

            set(ref(db, `sessions/${timeKey}`), newSessionData)
                .then(() => {
                    alert(`🎉 [${title}] 정모방이 정상적으로 개설되었습니다!`);
                    document.getElementById('newSessionTitle').value = '';
                });
        };
    }
};

// ==========================================
// 🏟️ [고도화] 정모 개별 제어실 (session.html) 엔진
// ==========================================
window.initSessionPage = function() {
    // 주소창 파라미터에서 ?id= 값 파싱 추출
    const urlParams = new URLSearchParams(window.location.search);
    targetSessionId = urlParams.get('id');

    if (!targetSessionId) {
        alert("❌ 올바른 정모 코드가 전달되지 않았습니다. 메인 대문에서 정모를 선택하세요!");
        window.location.href = "./index.html";
        return;
    }

    console.log(`🏟️ 타겟 정모 추적 리스너 파이프 온 : ${targetSessionId}`);
    
    // 1. 특정 타겟 정모 고유방 실시간 정밀 타겟 리스너 바인딩
    const specificSessionRef = ref(db, `sessions/${targetSessionId}`);
    onValue(specificSessionRef, (snapshot) => {
        let sessionData = snapshot.val();
        if (!sessionData) {
            alert("존재하지 않는 정모 세션입니다.");
            window.location.href = "./index.html";
            return;
        }
        currentActiveSession = sessionData;
        renderSessionViews(sessionData);
        if (sessionData.status === "진행중") {
            buildLiveCourtsDisplay();
        }
    });

    // 2. 유저 마스터 동기화 리스너
    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            allSystemPlayers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
            allSystemPlayers.sort((a, b) => a.id - b.id);
        }
        buildAttendanceGrid();
    });

    setupSessionEventListeners();
};

function renderSessionViews(session) {
    const badge = document.getElementById('statusBadge');
    const title = document.getElementById('sessionTitle');
    const vReady = document.getElementById('viewReady');
    const vLive = document.getElementById('viewLive');
    const vArchive = document.getElementById('viewArchive');

    if (!badge || !title || !vReady || !vLive || !vArchive) return;

    const finalTitle = session.title || "일요일 정모 리그전";
    title.innerText = `📅 ${finalTitle}`;
    
    const liveDisplay = document.getElementById('liveSessionNameDisplay');
    if (liveDisplay) liveDisplay.innerText = `🏆 현재 진행 중인 세션 : ${finalTitle}`;
    
    const archiveDisplay = document.getElementById('archiveSessionNameDisplay');
    if (archiveDisplay) archiveDisplay.innerText = `📁 정모 공식 명칭 : ${finalTitle}`;

    vReady.style.display = 'none';
    vLive.style.display = 'none';
    vArchive.style.display = 'none';
    badge.className = "text-xs font-bold px-2.5 py-1 rounded border font-sans ";

    if (session.status === "진행중") {
        badge.innerText = "🔥 라이브 진행 중";
        badge.classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-200');
        vLive.style.display = 'grid';
    } else if (session.status === "종료") {
        badge.innerText = "📝 정모 마감 완료";
        badge.classList.add('bg-indigo-50', 'text-indigo-700', 'border-indigo-200');
        vArchive.style.display = 'block';
    } else {
        badge.innerText = "⏳ 정모 대기중 (예정)";
        badge.classList.add('bg-amber-50', 'text-amber-700', 'border-amber-200');
        vReady.style.display = 'grid';
    }
}

function buildLiveCourtsDisplay() {
    const container = document.getElementById('courtsContainer');
    if (!container || !currentActiveSession || !targetSessionId) return;

    const totalCourtsCount = currentActiveSession.courts || 1;
    
    if (!currentActiveSession.matches) {
        currentActiveSession.matches = [];
        for (let i = 0; i < totalCourtsCount; i++) {
            currentActiveSession.matches.push(generateAutoBalancedMatch(i));
        }
        // 타겟팅 된 특정 정모 경로 하부에 대진표 주입
        set(ref(db, `sessions/${targetSessionId}/matches`), currentActiveSession.matches);
        return;
    }

    container.innerHTML = currentActiveSession.matches.map((m, idx) => {
        if (!m) return '';
        return `
            <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-4 flex flex-col justify-between">
                <div class="flex justify-between items-center border-b border-slate-100 pb-2">
                    <span class="text-xs font-black text-indigo-600 font-mono">🏟️ COURT ${idx + 1}</span>
                    <span class="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold px-1.5 py-0.5 rounded-sm">LIVE 경기 진행 중</span>
                </div>
                <div class="grid grid-cols-7 gap-1 items-center justify-center py-2 text-center">
                    <div class="col-span-3 text-xs font-bold text-slate-800 bg-slate-50/60 p-2.5 rounded-lg border border-slate-100">${m.teamANames.join(', ')}</div>
                    <div class="col-span-1 text-[11px] font-black text-slate-300 font-mono">VS</div>
                    <div class="col-span-3 text-xs font-bold text-slate-800 bg-slate-50/60 p-2.5 rounded-lg border border-slate-100">${m.teamBNames.join(', ')}</div>
                </div>
                <button data-index="${idx}" class="btn-open-score w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 rounded-lg text-xs transition shadow-xs cursor-pointer">⚖️ 결과 스코어 정산 입력</button>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.btn-open-score').forEach(btn => {
        btn.onclick = function() { openScoreModal(parseInt(this.getAttribute('data-index'))); };
    });
}

function generateAutoBalancedMatch(courtIdx) {
    const attendeesIds = currentActiveSession.attendees || [];
    const activePlayingIds = new Set();
    if (currentActiveSession && currentActiveSession.matches) {
        currentActiveSession.matches.forEach(m => {
            if (m && m.status === "LIVE") {
                m.teamA.forEach(id => activePlayingIds.add(id));
                m.teamB.forEach(id => activePlayingIds.add(id));
            }
        });
    }

    const waitingPlayers = allSystemPlayers.filter(p => attendeesIds.includes(p.id) && !activePlayingIds.has(p.id));
    let matchPool = waitingPlayers.length >= 4 ? waitingPlayers : allSystemPlayers.filter(p => attendeesIds.includes(p.id));
    const shuffled = [...matchPool].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 4);

    while (selected.length < 4) {
        selected.push({ id: 99, name: "대기회원", matchMmr: 1000, displayMmr: 1000 });
    }

    return {
        status: "LIVE",
        teamA: [selected[0].id, selected[1].id],
        teamANames: [selected[0].name, selected[1].name],
        teamB: [selected[2].id, selected[3].id],
        teamBNames: [selected[2].name, selected[3].name]
    };
}

function openScoreModal(courtIdx) {
    const match = currentActiveSession.matches[courtIdx];
    if (!match) return;
    activeModalCourtIndex = courtIdx;
    document.getElementById('modalCourtTitle').innerText = `🏟️ 제 ${courtIdx + 1}번 코트 경기 결과 정산`;
    document.getElementById('modalTeamANames').innerText = match.teamANames.join(', ');
    document.getElementById('modalTeamBNames').innerText = match.teamBNames.join(', ');
    document.getElementById('scoreA').value = 0;
    document.getElementById('scoreB').value = 0;
    document.getElementById('scoreModal').style.display = 'flex';
}

function processMmrMatchCalculation(courtIdx, scoreA, scoreB) {
    if (!targetSessionId) return;
    const match = currentActiveSession.matches[courtIdx];
    const scoreDiff = Math.abs(scoreA - scoreB);
    const bonusWeight = Math.min(5, Math.floor(scoreDiff / 3));
    const baseMmrChange = 15 + bonusWeight;

    const winnerTeam = scoreA > scoreB ? 'A' : 'B';
    const winIds = winnerTeam === 'A' ? match.teamA : match.teamB;
    const loseIds = winnerTeam === 'A' ? match.teamB : match.teamA;

    allSystemPlayers.forEach(p => {
        if (winIds.includes(p.id)) { p.matchesPlayed += 1; p.displayMmr += baseMmrChange; p.matchMmr += baseMmrChange; }
        else if (loseIds.includes(p.id)) { p.matchesPlayed += 1; p.displayMmr = Math.max(600, p.displayMmr - baseMmrChange); p.matchMmr = Math.max(600, p.matchMmr - baseMmrChange); }
    });

    set(ref(db, 'players'), allSystemPlayers);
    currentActiveSession.matches[courtIdx] = generateAutoBalancedMatch(courtIdx);
    set(ref(db, `sessions/${targetSessionId}/matches`), currentActiveSession.matches);

    alert(`✅ 정산 완료! 승리팀에 +${baseMmrChange}점이 즉시 반영되었습니다.`);
    document.getElementById('scoreModal').style.display = 'none';
}

function buildAttendanceGrid() {
    const grid = document.getElementById('attendanceGrid');
    if (!grid) return;
    if (!allSystemPlayers || allSystemPlayers.length === 0) return;

    grid.innerHTML = allSystemPlayers.map(p => {
        const isChecked = selectedPlayerIds.has(p.id);
        const activeClass = isChecked ? "bg-indigo-50 border-indigo-500 text-indigo-900 ring-2 ring-indigo-600/10 font-bold" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50/80 hover:border-slate-300";
        const badgeColor = p.tier === 'A' ? 'bg-rose-50 text-rose-600 border-rose-100' : p.tier === 'B' ? 'bg-amber-50 text-amber-600 border-amber-100' : p.tier === 'C' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-sky-50 text-sky-600 border-sky-100';

        return `
            <div data-id="${p.id}" class="player-card p-3.5 rounded-xl border text-left cursor-pointer transition-all flex justify-between items-center shadow-xs ${activeClass}">
                <div class="space-y-0.5">
                    <p class="text-[10px] text-slate-400 font-mono font-medium">ID ${String(p.id).padStart(2, '0')}</p>
                    <p class="text-xs font-bold font-sans">${p.name}</p>
                </div>
                <span class="text-[10px] font-sans font-bold px-2 py-0.5 rounded-md border ${badgeColor}">${p.tier}조</span>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.player-card').forEach(card => {
        card.onclick = function() {
            const pid = parseInt(this.getAttribute('data-id'));
            if (selectedPlayerIds.has(pid)) selectedPlayerIds.delete(pid);
            else selectedPlayerIds.add(pid);
            const cnt = document.getElementById('checkedCount');
            if (cnt) cnt.innerText = selectedPlayerIds.size;
            buildAttendanceGrid();
        };
    });
}

function setupSessionEventListeners() {
    const btnAll = document.getElementById('btnSelectAll');
    if (btnAll) {
        btnAll.onclick = function() {
            if (selectedPlayerIds.size === allSystemPlayers.length) selectedPlayerIds.clear();
            else allSystemPlayers.forEach(p => selectedPlayerIds.add(p.id));
            const cnt = document.getElementById('checkedCount');
            if (cnt) cnt.innerText = selectedPlayerIds.size;
            buildAttendanceGrid();
        };
    }

    const btnStart = document.getElementById('btnStartSession');
    if (btnStart) {
        btnStart.onclick = function() {
            if (!targetSessionId) return;
            if (selectedPlayerIds.size < 4) { alert("❌ 최소 4명 이상의 출석자가 필요합니다!"); return; }
            const selectedCourts = parseInt(document.getElementById('selectCourts').value);
            const finalAttendeeList = Array.from(selectedPlayerIds);

            update(ref(db, `sessions/${targetSessionId}`), {
                status: "진행중",
                courts: selectedCourts,
                attendees: finalAttendeeList
            });
        };
    }

    const btnCancel = document.getElementById('btnCancelModal');
    if (btnCancel) btnCancel.onclick = () => { document.getElementById('scoreModal').style.display = 'none'; };

    const btnSubmit = document.getElementById('btnSubmitScore');
    if (btnSubmit) {
        btnSubmit.onclick = () => {
            const scoreA = parseInt(document.getElementById('scoreA').value) || 0;
            const scoreB = parseInt(document.getElementById('scoreB').value) || 0;
            if (scoreA === scoreB) { alert("❌ 동점 종료는 불가능합니다!"); return; }
            if (activeModalCourtIndex !== null) processMmrMatchCalculation(activeModalCourtIndex, scoreA, scoreB);
        };
    }

    const btnEnd = document.getElementById('btnEndSession');
    if (btnEnd) {
        btnEnd.onclick = function() {
            if (!targetSessionId) return;
            if (confirm("🛑 정말 오늘 경기를 최종 종료하고 아카이브로 이관하시겠습니까?")) {
                update(ref(db, `sessions/${targetSessionId}`), { status: "종료" });
            }
        };
    }
}

// 회원 명단 백오피스용 호환성 기능 유지 (players.html)
let currentCachedPlayers = [];
window.listenToPlayers = function(callback) {
    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        let playersList = [];
        if (data) playersList = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
        playersList.sort((a, b) => a.id - b.id);
        currentCachedPlayers = playersList;
        if (typeof callback === 'function') callback(playersList);
    });
};
window.addNewPlayerToServer = function(name, age, tier, successCallback) {
    let maxId = 0;
    if (currentCachedPlayers.length > 0) maxId = Math.max(...currentCachedPlayers.map(p => p.id));
    const nextId = maxId + 1;
    const targetIndex = currentCachedPlayers.length;
    const newPlayerData = { id: nextId, name, age, tier, displayMmr: 1000, matchMmr: 1000, matchesPlayed: 0, streak: 0 };
    set(ref(db, `players/${targetIndex}`), newPlayerData).then(() => {
        alert(`🎉 [ID: ${nextId}] ${name} 회원이 서버에 성공적으로 등록되었습니다!`);
        if (typeof successCallback === 'function') successCallback();
    });
};
