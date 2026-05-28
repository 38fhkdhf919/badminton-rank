import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

let allSystemPlayers = [];
let selectedPlayerIds = new Set();
let targetSessionId = null;       
let currentActiveSession = null;
let activeModalCourtIndex = null;

// 🔥 [신규] 관리자 모드 활성화 상태 전역 변수
let isAdminMode = false;
const MASTER_PASSWORD = "1234"; // 임시 관리자 암호 (원하시는 번호로 변경 가능)

// ==========================================
// 🏢 대문 대시보드 (index.html) 제어 엔진
// ==========================================
window.initDashboardPage = function() {
    console.log("🏠 대시보드 관리자 모드 탑재 스캔 가동...");
    
    // 1. 파이어베이스 멀티 정모 목록 실시간 스캔
    const sessionsRef = ref(db, 'sessions');
    onValue(sessionsRef, (snapshot) => {
        const data = snapshot.val();
        const container = document.getElementById('sessionListContainer');
        if (!container) return;
        if (!data) {
            container.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs bg-slate-50 border rounded-xl">개설된 정모 세션이 전혀 없습니다.</div>`;
            return;
        }
        const sessionEntries = Object.entries(data).reverse();
        
        container.innerHTML = sessionEntries.map(([id, s]) => {
            let badgeStyle = "bg-amber-50 text-amber-700 border-amber-200";
            if (s.status === "진행중") badgeStyle = "bg-emerald-50 text-emerald-700 border-emerald-200 animate-pulse";
            if (s.status === "종료") badgeStyle = "bg-indigo-50 text-indigo-700 border-indigo-200";
            
            // 🔥 [관리자 핵심] 인증 상태일 때만 빨간색 삭제 단추를 코드 옆에 동적으로 생성 부착
            const deleteButtonHtml = isAdminMode 
                ? `<button data-id="${id}" class="btn-delete-session bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-bold text-[11px] px-2.5 py-2 rounded-lg transition shadow-2xs ml-3 cursor-pointer">🗑️ 삭제</button>`
                : '';

            return `
                <div class="flex items-center justify-between bg-white border border-slate-200 p-4 rounded-xl shadow-xs hover:border-indigo-300 transition-all">
                    <a href="./session.html?id=${id}" class="block flex-1 space-y-1">
                        <div class="flex items-center gap-2">
                            <h3 class="text-sm font-black text-slate-900">${s.title}</h3>
                            <span class="text-[10px] font-bold font-sans px-1.5 py-0.2 rounded border ${badgeStyle}">${s.status}</span>
                        </div>
                        <p class="text-[11px] text-slate-400 font-mono">개설코드: ${id} • 참여인원: ${s.attendees ? s.attendees.length : 0}명 / 코트: ${s.courts || 4}개</p>
                    </a>
                    ${deleteButtonHtml}
                </div>
            `;
        }).join('');

        // 🗑️ 삭제 버튼들 이벤트 주입
        document.querySelectorAll('.btn-delete-session').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                const sid = this.getAttribute('data-id');
                if (confirm(`⚠️ [🚨 경고 - 관리자 마스터 권한]\n정말 해당 정모방(${sid})을 서버에서 영구 삭제하시겠습니까?\n이 작업은 정모 내부의 대진표와 출석부가 통째로 유실됩니다.`)) {
                    remove(ref(db, `sessions/${sid}`))
                        .then(() => { alert("💥 정모가 서버에서 완전히 파괴 삭제되었습니다."); });
                }
            };
        });
    });

    // 2. 신규 정모 개설
    const form = document.getElementById('createSessionForm');
    if (form) {
        form.onsubmit = function(e) {
            e.preventDefault();
            const title = document.getElementById('newSessionTitle').value.trim();
            const now = new Date();
            const timeKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
            set(ref(db, `sessions/${timeKey}`), { status: "예정", title: title, courts: 4, createdAt: Date.now() }).then(() => {
                alert(`🎉 [${title}] 정모방이 정상 개설되었습니다!`);
                document.getElementById('newSessionTitle').value = '';
            });
        };
    }

    // 3. 🔥 [신규] 관리자 토글 버튼 클릭 이벤트 바인딩
    const toggleBtn = document.getElementById('btnAdminToggle');
    if (toggleBtn) {
        toggleBtn.onclick = function() {
            if (!isAdminMode) {
                // 패스워드 검증 절차 실행
                const pw = prompt("🔐 관리자 마스터 비밀번호를 입력하세요:");
                if (pw === MASTER_PASSWORD) {
                    isAdminMode = true;
                    this.innerText = "🔓 관리자 모드 해제";
                    this.className = "bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-sm cursor-pointer mr-2 flex items-center gap-1";
                    alert("🔓 관리자 인증 성공! 정모 편집 및 삭제 권한이 개방되었습니다.");
                    // 목록 다시 렌더링을 유도하기 위해 가짜 리프레시 실행 처리
                    if(window.initDashboardPage) window.initDashboardPage();
                } else if (pw !== null) {
                    alert("❌ 암호가 일치하지 않습니다. 접근 권한이 거부되었습니다.");
                }
            } else {
                isAdminMode = false;
                this.innerText = "🔐 관리자 모드 인증";
                this.className = "bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 transition shadow-2xs cursor-pointer mr-2 flex items-center gap-1";
                alert("🔒 관리자 모드가 안전하게 해제되었습니다.");
                if(window.initDashboardPage) window.initDashboardPage();
            }
        };
    }
};

// ==========================================
// 🏟️ 정모 개별 제어실 (session.html) 엔진
// ==========================================
window.initSessionPage = function() {
    const urlParams = new URLSearchParams(window.location.search);
    targetSessionId = urlParams.get('id');
    if (!targetSessionId) { window.location.href = "./index.html"; return; }

    const specificSessionRef = ref(db, `sessions/${targetSessionId}`);
    onValue(specificSessionRef, (snapshot) => {
        let sessionData = snapshot.val();
        if (!sessionData) return;
        currentActiveSession = sessionData;
        if (sessionData.attendees) {
            selectedPlayerIds = new Set(sessionData.attendees);
            const cnt = document.getElementById('checkedCount');
            if (cnt) cnt.innerText = selectedPlayerIds.size;
        }
        const selectC = document.getElementById('selectCourts');
        if (selectC && sessionData.courts) selectC.value = sessionData.courts;

        renderSessionViews(sessionData);
        if (sessionData.status === "진행중") {
            buildLiveCourtsDisplay();
            buildLiveWaitingQueueDisplay();
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
}

function buildAttendanceGrid() {
    const grid = document.getElementById('attendanceGrid');
    if (!grid || !allSystemPlayers || allSystemPlayers.length === 0) return;

    grid.innerHTML = allSystemPlayers.map(p => {
        const isChecked = selectedPlayerIds.has(p.id);
        const activeClass = isChecked ? "bg-indigo-50 border-indigo-50 text-indigo-900 ring-2 ring-indigo-600/10 font-bold" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50";
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

function buildLiveWaitingQueueDisplay() {
    const queueContainer = document.getElementById('liveWaitingContainer');
    if (!queueContainer || !currentActiveSession) return;
    const attendeesIds = currentActiveSession.attendees || [];
    const activePlayingIds = new Set();
    if (currentActiveSession.matches) {
        currentActiveSession.matches.forEach(m => {
            if (m && m.status === "LIVE") {
                m.teamA.forEach(id => activePlayingIds.add(id));
                m.teamB.forEach(id => activePlayingIds.add(id));
            }
        });
    }
    const attendancePlayers = allSystemPlayers.filter(p => attendeesIds.includes(p.id));
    queueContainer.innerHTML = attendancePlayers.map(p => {
        const isPlaying = activePlayingIds.has(p.id);
        const statusBadge = isPlaying 
            ? `<span class="bg-emerald-100 border border-emerald-200 text-emerald-800 font-black text-[9px] px-1.5 py-0.5 rounded-sm">🎾 경기중</span>`
            : `<span class="bg-blue-600 border border-blue-700 text-white font-black text-[9px] px-1.5 py-0.5 rounded-sm shadow-2xs">⏳ 대기중</span>`;
        const cardBg = isPlaying ? "bg-slate-50 border-slate-200 opacity-60" : "bg-white border-blue-200 ring-1 ring-blue-500/5";
        return `
            <div class="p-2 rounded-xl border flex justify-between items-center text-xs ${cardBg}">
                <div><span class="text-slate-800 font-extrabold text-[11px] block">${p.name}</span><span class="text-[9px] font-mono text-slate-400">${p.tier}조 • ${p.displayMmr}점</span></div>
                ${statusBadge}
            </div>
        `;
    }).join('');
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
        return `
            <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3 flex flex-col justify-between">
                <div class="flex justify-between items-center border-b border-slate-100 pb-1.5">
                    <span class="text-xs font-black text-indigo-600 font-mono">Stadium COURT ${idx + 1}</span>
                    <span class="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded font-bold">MATCH LIVE</span>
                </div>
                <div class="grid grid-cols-7 gap-1 items-center justify-center py-1 text-center">
                    <div class="col-span-3 text-[11px] font-bold text-slate-800 bg-slate-50 p-2 rounded-lg border border-slate-100">${m.teamANames.join(', ')}</div>
                    <div class="col-span-1 text-[10px] font-black text-slate-300">VS</div>
                    <div class="col-span-3 text-[11px] font-bold text-slate-800 bg-slate-50 p-2 rounded-lg border border-slate-100">${m.teamBNames.join(', ')}</div>
                </div>
                <button data-index="${idx}" class="btn-open-score w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 rounded-lg text-xs transition cursor-pointer">⚖️ 스코어 정산 입력</button>
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
    while (selected.length < 4) { selected.push({ id: 99, name: "대기회원", matchMmr: 1000, displayMmr: 1000 }); }
    return { status: "LIVE", teamA: [selected[0].id, selected[1].id], teamANames: [selected[0].name, selected[1].name], teamB: [selected[2].id, selected[3].id], teamBNames: [selected[2].name, selected[3].name] };
}

function openScoreModal(courtIdx) {
    const match = currentActiveSession.matches[courtIdx];
    if (!match) return;
    activeModalCourtIndex = courtIdx;
    document.getElementById('modalCourtTitle').innerText = ` Stadium 코트 ${courtIdx + 1} 결과 정산`;
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
    alert(` 정산 완료! 승리팀에 +${baseMmrChange}점이 즉시 반영되었습니다.`);
    document.getElementById('scoreModal').style.display = 'none';
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
    const btnSave = document.getElementById('btnSaveSetup');
    if (btnSave) {
        btnSave.onclick = function() {
            if (!targetSessionId) return;
            const selectedCourts = parseInt(document.getElementById('selectCourts').value);
            const finalAttendeeList = Array.from(selectedPlayerIds);
            update(ref(db, `sessions/${targetSessionId}`), { courts: selectedCourts, attendees: finalAttendeeList }).then(() => {
                alert("💾 [예정] 상태를 유지한 채 설정이 저장되었습니다!");
            });
        };
    }
    const btnStart = document.getElementById('btnStartSession');
    if (btnStart) {
        btnStart.onclick = function() {
            if (!targetSessionId) return;
            if (selectedPlayerIds.size < 4) { alert("❌ 최소 4명 이상의 출석자가 필요합니다!"); return; }
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
