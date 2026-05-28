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

// 전역 상태 변수 안전 기화
let allSystemPlayers = [];
let selectedPlayerIds = new Set();

// session.html 초기 가동 통합 게이트웨이
window.initSessionPage = function() {
    console.log("🏟️ initSessionPage 엔진 시동 시작...");
    
    const currentSessionRef = ref(db, 'currentSession');
    
    // 1. 현재 진행 정모 상태 실시간 리스너
    onValue(currentSessionRef, (snapshot) => {
        try {
            let sessionData = snapshot.val();
            if (!sessionData) {
                sessionData = {
                    status: "예정",
                    title: "",
                    courts: 4
                };
            }
            renderSessionViews(sessionData);
        } catch (err) {
            console.error("정모 상태 판독 에러 방어 처리:", err);
        }
    }, (error) => {
        console.error("파이어베이스 수신 연결실패 예방 통제:", error);
    });

    // 2. 전체 유저 데이터 로드 리스너
    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        try {
            const data = snapshot.val();
            if (data) {
                allSystemPlayers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
                allSystemPlayers.sort((a, b) => a.id - b.id);
            }
            buildAttendanceGrid();
        } catch (err) {
            console.error("유저 그리드 파싱 안전 가드 가동:", err);
        }
    });

    // 3. 컨트롤러 리스너 선제 연결
    setupSessionEventListeners();
};

// 화면 뷰 상태 제어 전환 스위처 함수 (hidden 유연 방어 기법)
function renderSessionViews(session) {
    const badge = document.getElementById('statusBadge');
    const title = document.getElementById('sessionTitle');
    
    const vReady = document.getElementById('viewReady');
    const vLive = document.getElementById('viewLive');
    const vArchive = document.getElementById('viewArchive');

    if (!badge || !title || !vReady || !vLive || !vArchive) {
        console.warn("DOM 엘리먼트가 아직 완전히 생성되지 않음 - 대기");
        return;
    }

    const finalTitle = session.title || "일요일 공식 정모 리그전";
    title.innerText = `📅 ${finalTitle}`;
    
    const liveDisplay = document.getElementById('liveSessionNameDisplay');
    if (liveDisplay) liveDisplay.innerText = `🏆 현재 진행 중인 세션 : ${finalTitle}`;

    // 안전하게 전체 숨김 클래스 주입 후 선별 해제
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
        // '예정'이거나 아예 데이터가 깨졌을 때 디폴트 구원 처리
        badge.innerText = "⏳ 정모 대기중 (예정)";
        badge.classList.add('bg-amber-50', 'text-amber-700', 'border-amber-200');
        vReady.style.display = 'grid';
    }
}

// 26인 출석 체크 리스트 드로잉 함수
function buildAttendanceGrid() {
    const grid = document.getElementById('attendanceGrid');
    if (!grid) return;

    if (!allSystemPlayers || allSystemPlayers.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-400 text-xs">DB 유저 데이터를 동기화하는 중입니다...</div>`;
        return;
    }

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
            if (selectedPlayerIds.has(pid)) {
                selectedPlayerIds.delete(pid);
            } else {
                selectedPlayerIds.add(pid);
            }
            const cnt = document.getElementById('checkedCount');
            if (cnt) cnt.innerText = selectedPlayerIds.size;
            buildAttendanceGrid();
        };
    });
}

// 이벤트 제어 바인딩 안정화
function setupSessionEventListeners() {
    const btnAll = document.getElementById('btnSelectAll');
    if (btnAll) {
        btnAll.onclick = function() {
            if (selectedPlayerIds.size === allSystemPlayers.length) {
                selectedPlayerIds.clear();
            } else {
                allSystemPlayers.forEach(p => selectedPlayerIds.add(p.id));
            }
            const cnt = document.getElementById('checkedCount');
            if (cnt) cnt.innerText = selectedPlayerIds.size;
            buildAttendanceGrid();
        };
    }

    const btnStart = document.getElementById('btnStartSession');
    if (btnStart) {
        btnStart.onclick = function() {
            if (selectedPlayerIds.size < 4) {
                alert("❌ 최소 4명 이상의 출석자가 선택되어야 밸런스 리그 매칭이 성사됩니다!");
                return;
            }
            
            let sessionTitleInput = document.getElementById('inputSessionTitle').value.trim();
            if (!sessionTitleInput) {
                const today = new Date();
                sessionTitleInput = `${today.getMonth() + 1}월 ${today.getDate()}일 정모 리그전`;
            }

            const selectedCourts = parseInt(document.getElementById('selectCourts').value);
            const finalAttendeeList = Array.from(selectedPlayerIds);

            if (confirm(`⚡ [${sessionTitleInput}]\n총 ${finalAttendeeList.length}명 출석 / [${selectedCourts}개 코트] 규모로 실시간 매칭 리그전을 즉시 가동하시겠습니까?`)) {
                const sessionRef = ref(db, 'currentSession');
                const startData = {
                    status: "진행중",
                    title: sessionTitleInput,
                    courts: selectedCourts,
                    attendees: finalAttendeeList,
                    createdAt: Date.now()
                };

                set(sessionRef, startData)
                    .then(() => { alert("🚀 리그전이 성공적으로 개설되었습니다! 라이브 전광판으로 자동 리다이렉트됩니다."); })
                    .catch((err) => { alert("서버 통신 실패: " + err); });
            }
        };
    }
}

// 회원관리용 호환 기능 유지
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
