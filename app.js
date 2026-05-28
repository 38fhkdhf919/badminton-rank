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

// 전역 캐싱 변수들
let allSystemPlayers = [];
let selectedPlayerIds = new Set();

// 🔥 [신규 핵심] session.html 통합 제어실 메인 초기화 구동 함수
window.initSessionPage = function() {
    const currentSessionRef = ref(db, 'currentSession');
    
    // 1. 파이어베이스의 현재 정모 상태(currentSession)를 실시간 감시
    onValue(currentSessionRef, (snapshot) => {
        let sessionData = snapshot.val();
        
        // 만약 서버에 정모 방 자체가 아예 없다면 임시 "예정" 디폴트 뼈대 생성
        if (!sessionData) {
            sessionData = {
                status: "예정",
                title: "이번주 일요일 정모 리그전",
                courts: 4
            };
        }

        // 2. 정모 상태값에 따른 화면 스위칭(뷰 전환) 처리
        renderSessionViews(sessionData);
    });

    // 3. 회원 DB 마스터 리스트 실시간 연동 리스너
    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            allSystemPlayers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
            allSystemPlayers.sort((a, b) => a.id - b.id);
        }
        // 화면에 출석부 그리드 리스트 그리기
        buildAttendanceGrid();
    });

    // 4. 이벤트 리스너 바인딩
    setupSessionEventListeners();
};

// 🌓 정모 상태에 따라 화면 레이아웃을 켜고 끄는 스위처 함수
function renderSessionViews(session) {
    const badge = document.getElementById('statusBadge');
    const title = document.getElementById('sessionTitle');
    
    const vReady = document.getElementById('viewReady');
    const vLive = document.getElementById('viewLive');
    const vArchive = document.getElementById('viewArchive');

    title.innerText = `📅 ${session.title || '일요일 정모 리그전'}`;
    
    // 모든 뷰단 숨기기 기본 세팅
    vReady.classList.add('hidden');
    vLive.classList.add('hidden');
    vArchive.classList.add('hidden');
    
    badge.className = "text-xs font-bold px-2.5 py-1 rounded border font-sans ";

    if (session.status === "예정") {
        badge.innerText = "⏳ 정모 대기중 (예정)";
        badge.classList.add('bg-amber-500/10', 'text-amber-400', 'border-amber-500/30');
        vReady.classList.remove('hidden'); // 출석체크 판넬 활성화
    } else if (session.status === "진행중") {
        badge.innerText = "🔥 실시간 리그전 진행 중";
        badge.classList.add('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/30');
        vLive.classList.remove('hidden'); // 대진표 전광판 활성화
    } else if (session.status === "종료") {
        badge.innerText = "📝 정모 마감 완료";
        badge.classList.add('bg-indigo-500/10', 'text-indigo-400', 'border-indigo-500/30');
        vArchive.classList.remove('hidden'); // 정산 결과실 활성화
    }
}

// 👥 26인 명단을 출석부 카드 버튼 형태로 동적 렌더링하는 함수
function buildAttendanceGrid() {
    const grid = document.getElementById('attendanceGrid');
    if (!grid) return;

    if (allSystemPlayers.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-8 text-slate-600">DB에 등록된 회원이 없습니다. players에서 먼저 등록하세요.</div>`;
        return;
    }

    grid.innerHTML = allSystemPlayers.map(p => {
        const isChecked = selectedPlayerIds.has(p.id);
        const activeClass = isChecked 
            ? "bg-indigo-600/30 border-indigo-500 text-white font-bold" 
            : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700";
        const badgeColor = p.tier === 'A' ? 'text-rose-400' : p.tier === 'B' ? 'text-amber-400' : p.tier === 'C' ? 'text-emerald-400' : 'text-sky-400';

        return `
            <div data-id="${p.id}" class="player-card p-3 rounded-lg border text-left cursor-pointer transition-all flex justify-between items-center ${activeClass}">
                <div class="space-y-0.5">
                    <p class="text-[10px] text-slate-500 font-mono font-normal">ID ${p.id}</p>
                    <p class="text-xs font-bold font-sans">${p.name}</p>
                </div>
                <span class="text-[10px] font-mono font-extrabold px-1.5 py-0.5 bg-slate-900/80 rounded border border-slate-800 ${badgeColor}">${p.tier}조</span>
            </div>
        `;
    }).join('');

    // 각각의 카드 터치 클릭 이벤트 심기
    document.querySelectorAll('.player-card').forEach(card => {
        card.addEventListener('click', function() {
            const pid = parseInt(this.getAttribute('data-id'));
            if (selectedPlayerIds.has(pid)) {
                selectedPlayerIds.delete(pid);
            } else {
                selectedPlayerIds.add(pid);
            }
            document.getElementById('checkedCount').innerText = selectedPlayerIds.size;
            buildAttendanceGrid(); // 자기 자신 상태 새로고침 리렌더링
        });
    });
}

// 🖱️ 버튼 제어 이벤트 리스너 조립
function setupSessionEventListeners() {
    // [전체 선택 / 해제] 토글 기능
    const btnAll = document.getElementById('btnSelectAll');
    if (btnAll) {
        btnAll.addEventListener('click', () => {
            if (selectedPlayerIds.size === allSystemPlayers.length) {
                selectedPlayerIds.clear();
            } else {
                allSystemPlayers.forEach(p => selectedPlayerIds.add(p.id));
            }
            document.getElementById('checkedCount').innerText = selectedPlayerIds.size;
            buildAttendanceGrid();
        });
    }

    // 🔥 [핵심 마스터 스위치] 정모 리그전 시작하기 버튼 클릭 시
    const btnStart = document.getElementById('btnStartSession');
    if (btnStart) {
        btnStart.addEventListener('click', () => {
            if (selectedPlayerIds.size < 4) {
                alert("❌ 배드민턴 경기를 성사시키려면 최소 4명 이상의 출석자가 선택되어야 합니다!");
                return;
            }
            
            const selectedCourts = parseInt(document.getElementById('selectCourts').value);
            const finalAttendeeList = Array.from(selectedPlayerIds);

            if (confirm(`⚡ 오늘 정모에 총 ${finalAttendeeList.length}명이 출석했습니다.\n[${selectedCourts}개 코트] 규모로 실시간 매칭 리그전을 즉시 가동하시겠습니까?`)) {
                
                // 파이어베이스 데이터베이스의 정모방 정보를 '진행중' 상태로 강제 전환 및 데이터 기입
                const sessionRef = ref(db, 'currentSession');
                const startData = {
                    status: "진행중",
                    title: "일요일 공식 정모 리그전",
                    courts: selectedCourts,
                    attendees: finalAttendeeList,
                    createdAt: Date.now()
                };

                set(sessionRef, startData)
                    .then(() => {
                        alert("🚀 리그전이 성공적으로 개설되었습니다! 라이브 전광판 시스템으로 자동 스위칭됩니다.");
                    })
                    .catch((err) => {
                        alert("서버 통신 실패: " + err);
                    });
            }
        });
    }
}

// [기존 1단계 하위 호환성 뼈대 유지]
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

console.log("✍️ app.js: 신규 유저 생성 트래커 모듈 준비 끝.");
