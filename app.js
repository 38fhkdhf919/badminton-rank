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

// 권한 제어 연동 추적 변수
let isSessionAdminMode = false;   // 현재 접속한 기기가 관리자인가?
let clientSelectedMyName = "";    // 회원이 지정한 자기 자신의 이름 선언

// ==========================================
// 🏢 대문 대시보드 (index.html) 제어 엔진
// ==========================================
let isAdminMode = false;
const MASTER_PASSWORD = "1234";

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
                        <p class="text-[11px] text-slate-400 font-mono">개설코드: ${id} • 참여인원: ${s.attendees ? s.attendees.length : 0}명 / 코트: ${s.courts || 4}개</p>
                    </a>
                    ${deleteButtonHtml}
                </div>
            `;
        }).join('');

        document.querySelectorAll('.btn-delete-session').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                const sid = this.getAttribute('data-id');
                if (confirm(`정말 해당 정모방(${sid})을 서버에서 영구 삭제하시겠습니까?`)) {
                    remove(ref(db, `sessions/${sid}`)).then(() => { alert("💥 정모가 서버에서 완전히 파괴 삭제되었습니다."); });
                }
            };
        });
    });

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

    const toggleBtn = document.getElementById('btnAdminToggle');
    if (toggleBtn) {
        toggleBtn.onclick = function() {
            if (!isAdminMode) {
                const pw = prompt("🔐 관리자 마스터 비밀번호를 입력하세요:");
                if (pw === MASTER_PASSWORD) {
                    isAdminMode = true;
                    this.innerText = "🔓 관리자 모드 해제";
                    this.className = "bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-sm cursor-pointer mr-2 flex items-center gap-1";
                    alert("🔓 관리자 인증 성공!");
                    if(window.initDashboardPage) window.initDashboardPage();
                } else if (pw !== null) { alert("❌ 암호가 틀렸습니다."); }
            } else {
                isAdminMode = false;
                this.innerText = "🔐 관리자 모드 인증";
                this.className = "bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 transition shadow-2xs cursor-pointer mr-2 flex items-center gap-1";
                alert("🔒 관리자 모드 해제 완료.");
                if(window.initDashboardPage) window.initDashboardPage();
            }
        };
    }
};

// ==========================================
// 🏟️ 정모 개별 제어실 (session.html) 엔진 (이원화 완벽 보수)
// ==========================================
window.initSessionPage = function() {
    const urlParams = new URLSearchParams(window.location.search);
    targetSessionId = urlParams.get('id');
    // 대문 주소창 링크 기어에 &admin=true 문구가 묻어있는지 체크 판독 수행
    isSessionAdminMode = urlParams.get('admin') === 'true';

    if (!targetSessionId) { window.location.href = "./index.html"; return; }

    // 👑 관리자 권한 상태에 따른 헤더 및 패널 차단 가드라인 배치
    const adminBadge = document.getElementById('adminClientBadge');
    const adminBtnGroup = document.getElementById('adminButtonGroup');
    const adminNotice = document.getElementById('adminOnlyLockNotice');
    const btnSelectAll = document.getElementById('btnSelectAll');
    const btnEndSession = document.getElementById('btnEndSession');

    if (isSessionAdminMode) {
        if(adminBadge) adminBadge.classList.remove('hidden');
        if(adminBtnGroup) adminBtnGroup.classList.remove('hidden');
        if(btnSelectAll) btnSelectAll.classList.remove('hidden');
        if(btnEndSession) btnEndSession.classList.remove('hidden');
        if(adminNotice) adminNotice.classList.add('hidden');
    } else {
        if(adminBadge) adminBadge.classList.add('hidden');
        if(adminBtnGroup) adminBtnGroup.classList.add('hidden'); // 일반 유저에겐 시작/저장 제어버튼 숨김 숨김
        if(btnSelectAll) btnSelectAll.classList.add('hidden');
        if(btnEndSession) btnEndSession.classList.add('hidden');
        if(adminNotice) adminNotice.classList.remove('hidden'); // 잠금 경고판 노출
    }

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
            buildLiveWaitingQueueDisplay(); // 대기열 재드로잉
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
        buildIdentityDropdown(); // 유저 식별 리스트 채우기
    });

    setupSessionEventListeners();
};

// 👤 내 이름 지정 시뮬레이션 목록 렌더링
function buildIdentityDropdown() {
    const select = document.getElementById('selectMyIdentity');
    if (!select || select.options.length > 1) return; // 이미 채워져 있다면 중복 리렌더링 패스
    
    allSystemPlayers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.innerText = `${p.name} (${p.tier}조)`;
        select.appendChild(opt);
    });

    select.onchange = function() {
        clientSelectedMyName = this.value;
        console.log(`🎯 클라이언트 본인 지칭 변경 선언 : ${clientSelectedMyName}`);
        if (currentActiveSession && currentActiveSession.status === "진행중") {
            buildLiveWaitingQueueDisplay(); // 권한 변동에 맞춰 댸기열 버튼 실시간 리프레시
        }
    };
}

// 👥 예정 상태의 출석 체크부 (관리자가 아니면 클릭 가로채서 편집 방어)
function buildAttendanceGrid() {
    const grid = document.getElementById('attendanceGrid');
    if (!grid || !allSystemPlayers || allSystemPlayers.length === 0) return;

    grid.innerHTML = allSystemPlayers.map(p => {
        const isChecked = selectedPlayerIds.has(p.id);
        const activeClass = isChecked ? "bg-indigo-50 border-indigo-500 text-indigo-900 ring-2 ring-indigo-600/10 font-bold" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50";
        const badgeColor = p.tier === 'A' ? 'bg-rose-50 text-rose-600 border-rose-100' : p.tier === 'B' ? 'bg-amber-50 text-amber-600 border-amber-100' : p.tier === 'C' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-sky-50 text-sky-600 border-sky-100';

        return `
            <div data-id="${p.id}" class="player-card p-3.5 rounded-xl border text-left transition-all flex justify-between items-center shadow-xs ${activeClass}">
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
            // 🔥 [일반인 변조 차단 가드] 관리자가 아닌 경우 출석 변경을 차단함
            if (!isSessionAdminMode) {
                alert("🔒 출석 체크 박스는 오직 관리자 계정에서만 변경 및 중간 저장이 가능합니다!");
                return;
            }
            const pid = parseInt(this.getAttribute('data-id'));
            if (selectedPlayerIds.has(pid)) selectedPlayerIds.delete(pid);
            else selectedPlayerIds.add(pid);
            const cnt = document.getElementById('checkedCount');
            if (cnt) cnt.innerText = selectedPlayerIds.size;
            buildAttendanceGrid();
        };
    });
}

// 📋 라이브 대기열 및 부상 제외 통제 엔진 (관리자 혹은 본인만 개방 매핑 기법 탑재)
function buildLiveWaitingQueueDisplay() {
    const queueContainer = document.getElementById('liveWaitingContainer');
    if (!queueContainer || !currentActiveSession) return;

    const attendeesIds = currentActiveSession.attendees || [];
    const injuredList = currentActiveSession.injuredPlayers || []; // 🔥 [신규] 부상 제외자 보관 트랙
    
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
        const isInjured = injuredList.includes(p.id);
        
        // 1. 상태 문구 추출 분기
        let statusBadge = `<span class="bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-2xs">⏳ 대기중</span>`;
        if (isPlaying) statusBadge = `<span class="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[9px] px-1.5 py-0.5 rounded font-bold">🎾 경기중</span>`;
        if (isInjured) statusBadge = `<span class="bg-rose-100 text-rose-700 border border-rose-200 text-[9px] px-1.5 py-0.5 rounded font-bold">🚑 쉼/부상</span>`;

        // 2. 🔥 [권한 핵심] 내가 관리자이거나, 혹은 이 카드가 '내 이름 설정 드롭다운'의 이름과 똑같다면 제어 버튼 권한 개방
        const hasControlPermission = isSessionAdminMode || (clientSelectedMyName === p.name);
        
        let actionBtnHtml = "";
        if (hasControlPermission && !isPlaying) {
            actionBtnHtml = isInjured 
                ? `<button data-id="${p.id}" class="btn-toggle-injury bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-xs transition-colors cursor-pointer">복귀</button>`
                : `<button data-id="${p.id}" class="btn-toggle-injury bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 border border-slate-300 hover:border-rose-300 text-[10px] font-bold px-2 py-1 rounded shadow-2xs transition-colors cursor-pointer">제외</button>`;
        }

        const cardBg = isInjured ? "bg-rose-50/50 border-rose-100 opacity-80" : isPlaying ? "bg-slate-50 border-slate-200 opacity-60" : "bg-white border-slate-200";

        return `
            <div class="p-3 rounded-xl border flex justify-between items-center ${cardBg}">
                <div class="flex items-center gap-2">
                    <div>
                        <span class="text-slate-800 font-extrabold text-xs block">${p.name} <span class="text-[10px] text-slate-400 font-normal font-mono">${p.tier}조</span></span>
                        <span class="text-[9px] font-mono text-slate-400">누적: ${p.displayMmr}점</span>
                    </div>
                </div>
                <div class="flex items-center gap-1.5">
                    ${statusBadge}
                    ${actionBtnHtml}
                </div>
            </div>
        `;
    }).join('');

    // 부상/제외 토글 버튼 리스너 바인딩 연산
    document.querySelectorAll('.btn-toggle-injury').forEach(btn => {
        btn.onclick = function() {
            const pid = parseInt(this.getAttribute('data-id'));
            let currentInjured = currentActiveSession.injuredPlayers ? [...currentActiveSession.injuredPlayers] : [];
            
            if (currentInjured.includes(pid)) {
                // 이미 있으면 복귀 처리 (제거)
                currentInjured = currentInjured.filter(id => id !== pid);
            } else {
                // 없으면 제외 명단 투입 (추가)
                currentInjured.push(pid);
            }

            // 서버에 부상 제외 명단 즉각 업데이트 동기화
            update(ref(db, `sessions/${targetSessionId}`), { injuredPlayers: currentInjured });
        };
    });
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
    const injuredList = currentActiveSession.injuredPlayers || []; // 🚑 부상 명단 트랙 스캔
    
    const activePlayingIds = new Set();
    if (currentActiveSession && currentActiveSession.matches) {
        currentActiveSession.matches.forEach(m => {
            if (m && m.status === "LIVE") {
                m.teamA.forEach(id => activePlayingIds.add(id));
                m.teamB.forEach(id => activePlayingIds.add(id));
            }
        });
    }

    // 🔥 [알고리즘 필터 고도화] 오늘 참석자 중 + 현재 코트 위에도 없고 + '부상 제외자 명단에도 없는' 찐 대기 유저만 선별 조합
    const waitingPlayers = allSystemPlayers.filter(p => attendeesIds.includes(p.id) && !activePlayingIds.has(p.id) && !injuredList.includes(p.id));
    
    let matchPool = waitingPlayers.length >= 4 
        ? waitingPlayers 
        : allSystemPlayers.filter(p => attendeesIds.includes(p.id) && !injuredList.includes(p.id)); // 부상자만 원천 배제
        
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
    
    // 🔒 점수입력 칸 경고창 핸들링
    const scoreNotice = document.getElementById('modalAdminOnlyNotice');
    const submitBtn = document.getElementById('btnSubmitScore');
    if (!isSessionAdminMode) {
        if(scoreNotice) scoreNotice.classList.remove('hidden');
        if(submitBtn) { submitBtn.style.display = 'none'; }
    } else {
        if(scoreNotice) scoreNotice.classList.add('hidden');
        if(submitBtn) { submitBtn.style.display = 'block'; }
    }

    document.getElementById('scoreModal').style.display = 'flex';
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
            if(!isSessionAdminMode) return;
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
            if(!isSessionAdminMode) return;
            if (!targetSessionId) return;
            const selectedCourts = parseInt(document.getElementById('selectCourts').value);
            const finalAttendeeList = Array.from(selectedPlayerIds);
            update(ref(db, `sessions/${targetSessionId}`), { courts: selectedCourts, attendees: finalAttendeeList }).then(() => {
                alert("💾 상태 보존 및 환경 설정 저장 완료!");
            });
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
        btnSubmit.onclick = () => {
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
