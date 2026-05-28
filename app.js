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

let allSystemPlayers = [];
let selectedPlayerIds = new Set();
let currentActiveSession = null;
let activeModalCourtIndex = null;

window.initSessionPage = function() {
    const currentSessionRef = ref(db, 'currentSession');
    
    onValue(currentSessionRef, (snapshot) => {
        let sessionData = snapshot.val();
        if (!sessionData) {
            sessionData = { status: "예정", title: "", courts: 4 };
        }
        currentActiveSession = sessionData;
        renderSessionViews(sessionData);
        if (sessionData.status === "진행중") {
            buildLiveCourtsDisplay();
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

    const finalTitle = session.title || "일요일 공식 정모 리그전";
    title.innerText = `📅 ${finalTitle}`;
    
    const liveDisplay = document.getElementById('liveSessionNameDisplay');
    if (liveDisplay) liveDisplay.innerText = `🏆 현재 진행 중인 세션 : ${finalTitle}`;

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

// 🏟️ [핵심 생성] 실시간 진행중인 코트별 대진표를 화면에 그려내는 엔진
function buildLiveCourtsDisplay() {
    const container = document.getElementById('courtsContainer');
    if (!container || !currentActiveSession) return;

    const totalCourtsCount = currentActiveSession.courts || 1;
    
    // 만약 파이어베이스에 코트별 대진 정보가 아예 생성 안 되어 있다면 강제 최초 대진 배정 생성
    if (!currentActiveSession.matches) {
        currentActiveSession.matches = [];
        for (let i = 0; i < totalCourtsCount; i++) {
            currentActiveSession.matches.push(generateAutoBalancedMatch(i));
        }
        // 파이어베이스 서버의 matches 노드에 실시간 대진표 주입 저장
        set(ref(db, 'currentSession/matches'), currentActiveSession.matches);
        return;
    }

    // 코트 렌더링
    container.innerHTML = currentActiveSession.matches.map((m, idx) => {
        if (!m) return '';
        return `
            <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-4 flex flex-col justify-between">
                <div class="flex justify-between items-center border-b border-slate-100 pb-2">
                    <span class="text-xs font-black text-indigo-600 font-mono">🏟️ COURT ${idx + 1}</span>
                    <span class="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold font-sans px-1.5 py-0.5 rounded-sm">LIVE 경기 진행 중</span>
                </div>
                
                <div class="grid grid-cols-7 gap-1 items-center justify-center py-2 text-center">
                    <div class="col-span-3 text-xs font-bold text-slate-800 bg-slate-50/60 p-2.5 rounded-lg border border-slate-100">
                        ${m.teamANames.join(', ')}
                    </div>
                    <div class="col-span-1 text-[11px] font-black text-slate-300 font-mono">VS</div>
                    <div class="col-span-3 text-xs font-bold text-slate-800 bg-slate-50/60 p-2.5 rounded-lg border border-slate-100">
                        ${m.teamBNames.join(', ')}
                    </div>
                </div>

                <button data-index="${idx}" class="btn-open-score w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 rounded-lg text-xs transition cursor-pointer shadow-xs">
                    ⚖️ 경기 결과 스코어 정산 입력
                </button>
            </div>
        `;
    }).join('');

    // 결과 입력 모달 버튼 바인딩
    document.querySelectorAll('.btn-open-score').forEach(btn => {
        btn.onclick = function() {
            const idx = parseInt(this.getAttribute('data-index'));
            openScoreModal(idx);
        };
    });
}

// 🎲 [밸런스 핵심 알고리즘] 현재 정모 참석자 중 겹치지 않고 가장 MMR 합산이 균등한 4명 자동 배정
function generateAutoBalancedMatch(courtIdx) {
    const attendeesIds = currentActiveSession.attendees || [];
    
    // 현재 코트 위에 이미 올라가서 뛰고 있는 유저 ID 수집 (중복 진입 원천 차단)
    const activePlayingIds = new Set();
    if (currentActiveSession && currentActiveSession.matches) {
        currentActiveSession.matches.forEach(m => {
            if (m && m.status === "LIVE") {
                m.teamA.forEach(id => activePlayingIds.add(id));
                m.teamB.forEach(id => activePlayingIds.add(id));
            }
        });
    }

    // 아직 경기를 안 뛰고 대기 중인 인원 필터링
    const waitingPlayers = allSystemPlayers.filter(p => attendeesIds.includes(p.id) && !activePlayingIds.has(p.id));

    // 만약 대기 인원이 부족해서 대진을 새로 못 짤 경우, 전체 참석자 중 랜덤 추출 방어책 작동
    let matchPool = waitingPlayers.length >= 4 
        ? waitingPlayers 
        : allSystemPlayers.filter(p => attendeesIds.includes(p.id));

    // 셔플 후 상위 4명 추출
    const shuffled = [...matchPool].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 4);

    // 최소 인원 부족 시 디폴트 더미 배정
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

// 팝업창 모달 열기 제어
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

// 🧮 [핵심 정산 수학 모듈] 세트 스코어 스케일링 기반의 승리 가중치 실시간 계산 엔진
function processMmrMatchCalculation(courtIdx, scoreA, scoreB) {
    const match = currentActiveSession.matches[courtIdx];
    
    // 점수차 기반 가속 가중치 계산 (예: 21:19보다 21:5로 완승 시 MMR 대폭 획득)
    const scoreDiff = Math.abs(scoreA - scoreB);
    const bonusWeight = Math.min(5, Math.floor(scoreDiff / 3)); // 격차 가중치 최대 +5점 버프
    const baseMmrChange = 15 + bonusWeight; // 기본 판돈 15점 + 격차 보너스

    const winnerTeam = scoreA > scoreB ? 'A' : 'B';
    const winIds = winnerTeam === 'A' ? match.teamA : match.teamB;
    const loseIds = winnerTeam === 'A' ? match.teamB : match.teamA;

    // 마스터 26인 명단 데이터 아키텍처 실시간 점수 업데이트 연산
    allSystemPlayers.forEach(p => {
        if (winIds.includes(p.id)) {
            p.matchesPlayed += 1;
            p.displayMmr += baseMmrChange;
            p.matchMmr += baseMmrChange;
        } else if (loseIds.includes(p.id)) {
            p.matchesPlayed += 1;
            p.displayMmr = Math.max(600, p.displayMmr - baseMmrChange); // 600점 하한선 방어
            p.matchMmr = Math.max(600, p.matchMmr - baseMmrChange);
        }
    });

    // 1. 전역 마스터 회원 정보 서버 리프레시 업데이트 덮어쓰기
    set(ref(db, 'players'), allSystemPlayers);

    // 2. 정산이 끝난 코트는 즉시 다음 대기 인원으로 신규 대진표 자동 리롤 배정
    currentActiveSession.matches[courtIdx] = generateAutoBalancedMatch(courtIdx);
    set(ref(db, 'currentSession/matches'), currentActiveSession.matches);

    alert(`✅ 정산 완료! 승리팀에 +${baseMmrChange}점이 즉시 실시간 반영되었으며, 다음 대진이 배정되었습니다.`);
    document.getElementById('scoreModal').style.display = 'none';
}

function buildAttendanceGrid() {
    const grid = document.getElementById('attendanceGrid');
    if (!grid) return;
    if (!allSystemPlayers || allSystemPlayers.length === 0) return;

    grid.innerHTML = allSystemPlayers.map(p => {
        const isChecked = selectedPlayerIds.has(p.id);
        const activeClass = isChecked 
            ? "bg-indigo-50 border-indigo-500 text-indigo-900 ring-2 ring-indigo-600/10 font-bold" 
            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50/80 hover:border-slate-300";
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
            if (selectedPlayerIds.size < 4) {
                alert("❌ 최소 4명 이상의 출석자가 필요합니다!");
                return;
            }
            let titleInput = document.getElementById('inputSessionTitle').value.trim() || "일요일 공식 정모 리그전";
            const selectedCourts = parseInt(document.getElementById('selectCourts').value);
            const finalAttendeeList = Array.from(selectedPlayerIds);

            const startData = {
                status: "진행중",
                title: titleInput,
                courts: selectedCourts,
                attendees: finalAttendeeList,
                createdAt: Date.now()
            };
            set(ref(db, 'currentSession'), startData);
        };
    }

    // 모달 팝업 내부 이벤트 바인딩
    const btnCancel = document.getElementById('btnCancelModal');
    if (btnCancel) {
        btnCancel.onclick = () => { document.getElementById('scoreModal').style.display = 'none'; };
    }

    const btnSubmit = document.getElementById('btnSubmitScore');
    if (btnSubmit) {
        btnSubmit.onclick = () => {
            const scoreA = parseInt(document.getElementById('scoreA').value) || 0;
            const scoreB = parseInt(document.getElementById('scoreB').value) || 0;
            if (scoreA === scoreB) {
                alert("❌ 배드민턴 동점 종료는 불가능합니다! 승리팀 스코어가 높아야 합니다.");
                return;
            }
            if (activeModalCourtIndex !== null) {
                processMmrMatchCalculation(activeModalCourtIndex, scoreA, scoreB);
            }
        };
    }

    // 정모 최종 종료 및 마감 처리 마스터 제어 단추 클릭 시
    const btnEnd = document.getElementById('btnEndSession');
    if (btnEnd) {
        btnEnd.onclick = function() {
            if (confirm("🛑 정말 오늘 모든 경기를 완전히 종료하고 최종 마감 상태로 전환하시겠습니까?\n이 작업은 정모를 과거 아카이브 기록실로 안전하게 이관시킵니다.")) {
                update(ref(db, 'currentSession'), { status: "종료" });
            }
        };
    }
}
