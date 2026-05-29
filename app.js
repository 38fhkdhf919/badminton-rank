import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

// 👑 [개선] 관리자 모드 로그인 상태 영구 브라우저 홀딩 기믹 (새로고침 가드)
window.isAdminMode = localStorage.getItem("badminton_admin_login") === "true";
window.currentActiveSession = null;
window.currentSessionKey = null;
let activeChartInstance = null;

// 📡 [구조 개혁] 소스코드 내부 고정 명단 전면 삭제! 실시간 원격 동기화 캐시 배열로 전환
window.allSystemPlayers = [];

onValue(ref(db, 'players'), (snapshot) => {
    const data = snapshot.val();
    if (data) {
        window.allSystemPlayers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
        window.allSystemPlayers.sort((a, b) => a.id - b.id);
        console.log("📡 파이어베이스 원격 창고로부터 실시간 회원 명단 동기화 완료:", window.allSystemPlayers.length, "명");
        
        // 데이터가 실시간으로 수신되면 랭킹보드와 드롭다운을 유기적으로 즉시 리렌더링
        if (document.getElementById('globalRankTableBody') && window.currentActiveSession === null) {
            // 대문 페이지에 있고 세션 컨텍스트가 없을 때 글로벌 랭킹 연산 실행
            const sessionsRef = ref(db, 'sessions');
            onValue(sessionsRef, (snap) => { if(snap.val()) calculateGlobalLeaderboard(snap.val()); }, { onlyOnce: true });
        }
    } else {
        window.allSystemPlayers = [];
        console.warn("⚠️ 파이어베이스 DB에 등록된 회원 명단(/players)이 비어 있습니다.");
    }
});

function getNamesFromIds(ids, fallbackNames) {
    if (fallbackNames && fallbackNames.length > 0) return fallbackNames.filter(Boolean);
    if (!ids || ids.length === 0) return ["대기회원"];
    return ids.map(id => {
        const p = window.allSystemPlayers.find(x => x.id === parseInt(id));
        return p ? p.name : `회원(${id})`;
    }).filter(Boolean);
}

// ==========================================
// 🏢 대문 통합 연동 제어반
// ==========================================
window.initDashboardPage = function() {
    const btnToggle = document.getElementById('btnAdminToggle');
    if (btnToggle) {
        if (isAdminMode) {
            btnToggle.innerText = "🔓 관리자 모드 인증 해제";
            btnToggle.className = "bg-indigo-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition shadow-sm cursor-pointer flex items-center gap-1.5";
        } else {
            btnToggle.innerText = "🔐 마스터 관리자 인증";
            btnToggle.className = "bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl border border-slate-700 transition shadow-sm cursor-pointer flex items-center gap-1.5";
        }

        btnToggle.onclick = function() {
            if (!isAdminMode) {
                if (prompt("🔐 관리자 마스터 비밀번호를 입력하세요:") === "1234") {
                    isAdminMode = true;
                    localStorage.setItem("badminton_admin_login", "true");
                    alert("🔓 관리자 권한 승인! 대진 제어반이 잠금 해제되었습니다.");
                } else { alert("❌ 비밀번호 불일치!"); return; }
            } else {
                isAdminMode = false;
                localStorage.setItem("badminton_admin_login", "false");
                alert("🔐 관리자 인증이 해제되었습니다.");
            }
            window.location.reload();
        };
    }

    const sessionsRef = ref(db, 'sessions');
    onValue(sessionsRef, (snapshot) => {
        const data = snapshot.val();
        const container = document.getElementById('sessionListContainer');
        const badgeCount = document.getElementById('sessionCountBadge');
        if (!container) return;
        if (!data) {
            container.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">개설된 정모 세션이 전혀 없습니다.</div>`;
            if (badgeCount) badgeCount.innerText = "0개 방";
            return;
        }

        const sessionEntries = Object.entries(data).reverse();
        if (badgeCount) badgeCount.innerText = `${sessionEntries.length}개 방`;

        calculateGlobalLeaderboard(data);

        container.innerHTML = sessionEntries.map(([id, s]) => {
            let badgeStyle = "bg-amber-50 text-amber-700 border-amber-200";
            if (s.status === "진행중") badgeStyle = "bg-emerald-50 text-emerald-700 border-emerald-200 animate-pulse";
            if (s.status === "종료") badgeStyle = "bg-indigo-50 text-indigo-700 border-indigo-200";
            
            const delBtn = isAdminMode ? `<button data-id="${id}" class="btn-delete-session bg-rose-50 text-rose-600 border border-rose-200 font-bold text-[10px] px-2 py-0.5 rounded-lg cursor-pointer ml-2">🗑️</button>` : '';
            const displayDate = s.date ? s.date : id.split('_')[0].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
            const displayScore = s.targetScore ? `${s.targetScore}점 제` : "21점 제";

            return `
                <div class="flex items-center justify-between bg-white border border-slate-200 p-4 rounded-xl shadow-3xs hover:border-indigo-400 transition-all">
                    <a href="./session.html?id=${id}${isAdminMode ? '&admin=true' : ''}" class="block flex-1 space-y-1">
                        <div class="flex items-center gap-2">
                            <h3 class="text-sm font-black text-slate-900">${s.title}</h3>
                            <span class="text-[9px] font-black px-1.5 py-0.5 rounded border ${badgeStyle}">${s.status}</span>
                        </div>
                        <p class="text-[11px] text-slate-400 font-mono">📅 정모일: ${displayDate} • 🎯 ${displayScore} • 참여: ${s.attendees ? s.attendees.length : 0}명 ${s.isTestMode ? '🤖[AI]' : ''}</p>
                    </a>
                    ${delBtn}
                </div>
            `;
        }).join('');

        document.querySelectorAll('.btn-delete-session').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                const sid = this.getAttribute('data-id');
                if (confirm(`해당 정모방(${sid})을 완전 철거하시겠습니까?`)) {
                    remove(ref(db, `sessions/${sid}`)).then(() => window.location.reload());
                }
            };
        });

        const wrapper = document.getElementById('testModeWrapper');
        if (wrapper) wrapper.style.display = isAdminMode ? 'flex' : 'none';
    });

    const form = document.getElementById('createSessionForm');
    if (form) {
        form.onsubmit = function(e) {
            e.preventDefault();
            const title = document.getElementById('newSessionTitle').value.trim();
            const dateVal = document.getElementById('newSessionDate').value;
            const scoreVal = parseInt(document.querySelector('input[name="targetScore"]:checked').value);
            const isTest = document.getElementById('checkboxTestMode').checked;

            const now = new Date();
            const timeKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

            set(ref(db, `sessions/${timeKey}`), {
                status: "예정",
                title: title,
                date: dateVal,
                targetScore: scoreVal,
                isTestMode: isTest,
                createdAt: Date.now()
            }).then(() => {
                alert(`🎉 [${title} (${scoreVal}점제)] 정모방이 정상 개설되었습니다!`);
                window.location.reload();
            });
        };
    }

    const btnGlobalSrc = document.getElementById('btnGlobalSearchRecord');
    if (btnGlobalSrc) btnGlobalSrc.onclick = () => { executeGlobalRecordSearch(); };
};

// ==========================================
// 🏆 누적 랭킹 성장선 곡선 차트 연산부
// ==========================================
function calculateGlobalLeaderboard(allSessions) {
    const tbody = document.getElementById('globalRankTableBody');
    if (!tbody || window.allSystemPlayers.length === 0) return;

    let aggregateMap = {};
    window.allSystemPlayers.forEach(p => {
        aggregateMap[p.id] = { id: p.id, name: p.name, tier: p.tier, baseMmr: p.displayMmr, win: 0, lose: 0, deltaSum: 0, historyTimeline: [] };
    });

    const sortedSessions = Object.entries(allSessions).sort((a,b) => a[1].createdAt - b[1].createdAt);

    sortedSessions.forEach(([sKey, s]) => {
        if (s.statsLog) {
            Object.entries(s.statsLog).forEach(([pId, log]) => {
                const player = aggregateMap[pId];
                if (player) {
                    player.win += (log.win || 0);
                    player.lose += (log.lose || 0);
                    player.deltaSum += (log.delta || 0);
                    player.historyTimeline.push(player.baseMmr + player.deltaSum);
                }
            });
        }
    });

    let sortedList = Object.values(aggregateMap).sort((a, b) => (b.baseMmr + b.deltaSum) - (a.baseMmr + a.deltaSum));

    tbody.innerHTML = sortedList.map((p, idx) => {
        const total = p.win + p.lose;
        const rate = total > 0 ? Math.round((p.win / total) * 100) : 0;
        const currentMmr = p.baseMmr + p.deltaSum;
        const isLeader = idx === 0 && total > 0;

        return `
            <tr class="hover:bg-indigo-50/40 transition-colors cursor-pointer btn-open-trend-chart" data-id="${p.id}" data-name="${p.name}" data-timeline="${JSON.stringify(p.historyTimeline)}">
                <td class="py-2.5 px-4 text-center font-black text-slate-400 font-mono">${idx + 1}</td>
                <td class="py-2.5 px-4 font-black text-indigo-950 underline decoration-indigo-300 decoration-dashed">${p.name} <span class="text-[10px] text-slate-400 font-normal">(${p.tier}조)</span> ${isLeader ? '🔥' : ''}</td>
                <td class="py-2.5 px-4 text-center font-mono text-slate-500">${total}판</td>
                <td class="py-2.5 px-4 text-center font-mono text-slate-600">${p.win}승 ${p.lose}패</td>
                <td class="py-2.5 px-4 text-center font-mono font-black text-indigo-600">${rate}%</td>
                <td class="py-2.5 px-4 text-right font-black font-mono text-slate-900">${currentMmr}점</td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('.btn-open-trend-chart').forEach(tr => {
        tr.onclick = function() {
            const pId = this.getAttribute('data-id');
            const pName = this.getAttribute('data-name');
            const timeline = JSON.parse(this.getAttribute('data-timeline'));

            document.getElementById('modalPlayerTitle').innerText = `🏆 [${pName}] 회원 실시간 MMR 성장 트렌드`;
            document.getElementById('chartModal').classList.remove('hidden');

            const chartData = timeline.length > 0 ? timeline.slice(-7) : [aggregateMap[pId].baseMmr];
            const labels = chartData.map((_, i) => `${i + 1}차전`);

            const ctx = document.getElementById('playerTrendChart').getContext('2d');
            if (activeChartInstance) activeChartInstance.destroy();

            activeChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '누적 레이팅 스코어(MMR)',
                        data: chartData,
                        borderColor: '#4f46e5',
                        backgroundColor: 'rgba(79, 70, 229, 0.08)',
                        borderWidth: 3,
                        pointBackgroundColor: '#ffffff',
                        pointBorderColor: '#4f46e5',
                        pointBorderWidth: 2,
                        pointRadius: 4,
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { grid: { color: '#f1f5f9' } },
                        x: { grid: { display: false } }
                    }
                }
            });
        };
    });

    const closeBtn = document.getElementById('btnCloseModal');
    if(closeBtn) closeBtn.onclick = () => document.getElementById('chartModal').classList.add('hidden');
}

// ==========================================
// 🏟️ 특정 정모 세션 제어 페이지 개조부
// ==========================================
window.initSessionPage = function() {
    const urlParams = new URLSearchParams(window.location.search);
    currentSessionKey = urlParams.get('id');
    if (!currentSessionKey) return;

    if(urlParams.get('admin') === 'true') {
        isAdminMode = true;
        localStorage.setItem("badminton_admin_login", "true");
    }

    const sessionRef = ref(db, `sessions/${currentSessionKey}`);
    onValue(sessionRef, (snapshot) => {
        const s = snapshot.val();
        if (!s) return;
        window.currentActiveSession = s;

        document.getElementById('sessionMainTitle').innerText = s.title;
        document.getElementById('sessionMetaText').innerText = `📅 정모일: ${s.date || '미정'} • 🎯 목표스코어: ${s.targetScore || 21}점 제`;
        
        const statusBadge = document.getElementById('sessionStatusBadge');
        if(statusBadge) {
            statusBadge.innerText = s.status;
            if(s.status === "진행중") statusBadge.className = "text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 animate-pulse";
            else if(s.status === "종료") statusBadge.className = "text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200";
            else statusBadge.className = "text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200";
        }

        const adminPanel = document.getElementById('adminPanel');
        const btnToggleStatus = document.getElementById('btnToggleStatus');
        if (isAdminMode && adminPanel && btnToggleStatus) {
            adminPanel.classList.remove('hidden');
            adminPanel.classList.add('flex');
            btnToggleStatus.innerText = s.status === "예정" ? "▶️ 정모 매칭 가동 시작" : (s.status === "진행중" ? "🛑 오늘 정모 최종 마감/종료" : "🔒 정모 폐쇄됨");
            btnToggleStatus.disabled = s.status === "종료";
            
            btnToggleStatus.onclick = function() {
                if (s.status === "예정") {
                    update(sessionRef, { status: "진행중" }).then(() => recalculateLiveQueueMatch());
                } else if (s.status === "진행중") {
                    if (confirm("오늘 정모를 최종 마감하시겠습니까? 종료 후에는 매칭 알고리즘이 정지하며 아카이브로 보관됩니다.")) {
                        update(sessionRef, { status: "종료" });
                    }
                }
            };
        }

        renderAttendanceBox(s);
        renderLiveCourtsGrid(s);
        renderSessionRankTable(s);
        
        const searchInput = document.getElementById('inputLocalSearchPlayer');
        if(searchInput) {
            if(!searchInput.value) searchInput.value = localStorage.getItem("my_badminton_name") || "";
            if(searchInput.value) executeLocalRecordSearch(searchInput.value);
            searchInput.oninput = function() { executeLocalRecordSearch(this.value); };
        }
    });
};

function renderAttendanceBox(s) {
    const attendees = s.attendees || [];
    const restList = s.restPlayers || [];
    const container = document.getElementById('attendanceTogglerBox');
    const label = document.getElementById('attendeeCountLabel');
    if(label) label.innerText = `${attendees.length}명 참여 중`;
    
    if (container && window.allSystemPlayers.length > 0) {
        if(s.status === "종료") {
            container.innerHTML = `<div class="text-[11px] text-slate-400 py-2 w-full text-center">🔐 정모 종료로 출석부가 잠겼습니다.</div>`;
        } else {
            container.innerHTML = window.allSystemPlayers.map(p => {
                const isChecked = attendees.includes(p.id);
                const isResting = restList.includes(p.id);
                let btnStyle = isChecked ? "bg-indigo-600 text-white font-black" : "bg-slate-100 text-slate-600 border border-slate-200";
                if(isResting) btnStyle = "bg-amber-100 text-amber-800 border-amber-300 line-through";

                return `<button data-id="${p.id}" class="btn-toggle-attend text-[11px] px-2.5 py-1 rounded-xl transition cursor-pointer ${btnStyle}">${p.name}</button>`;
            }).join('');

            document.querySelectorAll('.btn-toggle-attend').forEach(btn => {
                btn.onclick = function() {
                    const pId = parseInt(this.getAttribute('data-id'));
                    let nextAttendees = [...attendees];
                    let nextRest = [...restList];

                    if (!nextAttendees.includes(pId)) {
                        nextAttendees.push(pId);
                    } else {
                        if (!nextRest.includes(pId)) {
                            nextRest.push(pId);
                        } else {
                            nextRest = nextRest.filter(x => x !== pId);
                            nextAttendees = nextAttendees.filter(x => x !== pId);
                        }
                    }
                    
                    update(ref(db, `sessions/${currentSessionKey}`), { attendees: nextAttendees, restPlayers: nextRest }).then(() => {
                        recalculateLiveQueueMatch();
                    });
                };
            });
        }
    }

    const restContainer = document.getElementById('restPlayersContainer');
    if (restContainer) {
        if (restList.length === 0) {
            restContainer.innerHTML = `<div class="text-[10px] text-slate-400 italic py-1">현재 쉼터가 비어있습니다.</div>`;
        } else {
            restContainer.innerHTML = restList.map(id => {
                const p = window.allSystemPlayers.find(x => x.id === id);
                const name = p ? p.name : `회원(${id})`;
                const backBtn = s.status !== "종료" ? `<span class="bg-amber-500 text-white font-sans font-black text-[9px] px-1 rounded-sm ml-1 cursor-pointer rounded-xs">복귀</span>` : '';
                return `<div data-id="${id}" class="btn-return-queue flex items-center bg-amber-50 border border-amber-200 text-amber-800 font-bold px-2 py-0.5 rounded-lg text-[11px]">${name}${backBtn}</div>`;
            }).join('');

            if(s.status !== "종료") {
                document.querySelectorAll('.btn-return-queue').forEach(div => {
                    div.onclick = function() {
                        const pId = parseInt(this.getAttribute('data-id'));
                        const nextRest = restList.filter(x => x !== pId);
                        update(ref(db, `sessions/${currentSessionKey}`), { restPlayers: nextRest }).then(() => {
                            recalculateLiveQueueMatch();
                        });
                    };
                });
            }
        }
    }
}

// ==========================================
// 🏸 [순위 대진 변형] 경기 가드 및 매칭 엔진
// ==========================================
function renderLiveCourtsGrid(s) {
    const liveContainer = document.getElementById('liveCourtsContainer');
    const alertBox = document.getElementById('unsubmittedAlertBox');
    const alertList = document.getElementById('unsubmittedMatchesList');
    if (!liveContainer) return;

    const currentMatches = s.currentMatches || [];
    const historyLog = s.historyLog || [];

    const unsubmitted = currentMatches.filter(m => m.status === "완료" && (m.scoreA === undefined || m.scoreA === null));
    if (unsubmitted.length > 0 && alertBox && alertList) {
        alertBox.classList.remove('hidden'); alertBox.classList.add('flex');
        alertList.innerHTML = unsubmitted.map(m => {
            const aNames = getNamesFromIds(m.teamA, m.teamANames).join(', ');
            const bNames = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
            return `<button data-id="${m.id}" class="btn-open-score text-left w-full bg-white hover:bg-slate-50 border border-rose-300 rounded-xl p-2 text-[11px] font-bold text-rose-900 block font-mono">🚨 [미입력] ${aNames} VS ${bNames} (터치해서 스코어 입력)</button>`;
        }).join('');
    } else if (alertBox) { alertBox.classList.remove('flex'); alertBox.classList.add('hidden'); }

    if (s.status === "예정") {
        liveContainer.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">상단의 [정모 매칭 가동 시작] 버튼을 클릭하시면 실시간 우선순위 조합 큐가 열립니다.</div>`;
        return;
    }

    if(s.status === "종료") {
        if(historyLog.length === 0) {
            liveContainer.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">오늘 치러진 공식 경기 일지가 없습니다.</div>`;
        } else {
            liveContainer.innerHTML = [...historyLog].reverse().map((m, idx) => {
                const aNames = getNamesFromIds(m.teamA, m.teamANames).join(', ');
                const bNames = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
                return `
                    <div class="bg-white border border-indigo-100 p-3.5 rounded-2xl shadow-3xs flex items-center justify-between text-xs">
                        <div class="space-y-1">
                            <span class="bg-indigo-100 text-indigo-800 text-[10px] font-black font-mono px-2 py-0.5 rounded-md">🏁 제 ${historyLog.length - idx}경기 완료</span>
                            <div class="font-extrabold text-slate-800">${aNames} <span class="text-slate-400 font-normal mx-1">VS</span> ${bNames}</div>
                        </div>
                        <div class="font-mono font-black text-sm text-indigo-600 bg-slate-50 border border-slate-200 px-3 py-1 rounded-xl">${m.scoreA} : ${m.scoreB}</div>
                    </div>
                `;
            }).join('');
        }
        return;
    }

    if (currentMatches.length === 0) {
        liveContainer.innerHTML = `<div class="text-center py-10 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">대기열 연산 중... 출석 명단이 확인되면 자동으로 매칭 대진이 형성됩니다.</div>`;
        return;
    }

    liveContainer.innerHTML = currentMatches.map((m, idx) => {
        if (m.status === "완료") return '';
        
        const aNames = getNamesFromIds(m.teamA, m.teamANames).join(', ');
        const bNames = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
        
        const isLive = m.status === "진행중";
        const borderStyle = isLive ? "border-2 border-emerald-400 bg-emerald-50/10" : "border border-slate-200 bg-white";
        const badge = isLive 
            ? `<span class="bg-emerald-500 text-white text-[10px] font-black font-sans px-2 py-0.5 rounded-md animate-pulse">⚡ 현재 진행 중</span>`
            : `<span class="bg-indigo-50 text-indigo-700 text-[10px] font-black font-sans px-2 py-0.5 rounded-md border border-indigo-200">⏳ ${idx + 1}순위 추천 대진</span>`;

        const ctrlBtn = isLive
            ? `<button data-id="${m.id}" class="btn-open-score bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-3 py-2 rounded-xl transition shadow-sm cursor-pointer">🛑 경기 종료 (스코어 입력)</button>`
            : `<button data-id="${m.id}" class="btn-start-match bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs px-3 py-2 rounded-xl transition shadow-sm cursor-pointer">▶️ 경기 시작 확정</button>`;

        return `
            <div class="rounded-2xl p-4 shadow-3xs transition-all space-y-3 ${borderStyle}">
                <div class="flex justify-between items-center">
                    <div class="flex items-center gap-1.5">${badge}</div>
                    <div>${ctrlBtn}</div>
                </div>
                <div class="grid grid-cols-7 text-center items-center font-sans">
                    <div class="col-span-3 font-black text-slate-900 text-xs tracking-tight">${aNames}</div>
                    <div class="col-span-1 font-mono font-black text-slate-300 text-xs">VS</div>
                    <div class="col-span-3 font-black text-slate-900 text-xs tracking-tight">${bNames}</div>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.btn-start-match').forEach(btn => {
        btn.onclick = function() {
            const mId = this.getAttribute('data-id');
            const target = currentMatches.find(x => x.id === mId);
            if(target) {
                target.status = "진행중";
                update(ref(db, `sessions/${currentSessionKey}`), { currentMatches: currentMatches });
            }
        };
    });

    document.querySelectorAll('.btn-open-score').forEach(btn => {
        btn.onclick = function() { openScoreModal(this.getAttribute('data-id')); };
    });
}

function recalculateLiveQueueMatch() {
    const s = window.currentActiveSession;
    if (!s || s.status !== "진행중" || window.allSystemPlayers.length === 0) return;

    let currentMatches = s.currentMatches || [];
    const attendees = s.attendees || [];
    const restList = s.restPlayers || [];
    const historyLog = s.historyLog || [];

    const lockedMatches = currentMatches.filter(m => m.status === "진행중" || m.status === "완료");
    
    let busyIds = new Set();
    lockedMatches.forEach(m => {
        m.teamA.forEach(id => busyIds.add(id));
        m.teamB.forEach(id => busyIds.add(id));
    });
    restList.forEach(id => busyIds.add(id));

    let availableIds = attendees.filter(id => !busyIds.has(id)); 

    let playCounts = {};
    attendees.forEach(id => playCounts[id] = 0);
    historyLog.forEach(m => {
        [...m.teamA, ...m.teamB].forEach(id => { if(playCounts[id] !== undefined) playCounts[id]++; });
    });

    let queue = availableIds.sort((a, b) => (playCounts[a] || 0) - (playCounts[b] || 0));

    let nextMatches = [...lockedMatches];
    const targetSlots = 2 - nextMatches.length;

    for (let i = 0; i < targetSlots; i++) {
        if (queue.length >= 4) {
            const p1 = queue.shift(); const p2 = queue.shift();
            const p3 = queue.shift(); const p4 = queue.shift();
            
            nextMatches.push({
                id: `m_${Date.now()}_${i}`,
                status: "대기",
                teamA: [p1, p2],
                teamB: [p3, p4],
                teamANames: getNamesFromIds([p1, p2]),
                teamBNames: getNamesFromIds([p3, p4])
            });
        }
    }

    update(ref(db, `sessions/${currentSessionKey}`), { currentMatches: nextMatches });
}

function renderSessionRankTable(s) {
    const tbody = document.getElementById('sessionRankTableBody');
    if (!tbody || window.allSystemPlayers.length === 0) return;

    const attendees = s.attendees || [];
    const historyLog = s.historyLog || [];

    let map = {};
    attendees.forEach(id => {
        const p = window.allSystemPlayers.find(x => x.id === id);
        map[id] = { name: p ? p.name : `회원(${id})`, win: 0, lose: 0, scoreDiff: 0 };
    });

    historyLog.forEach(m => {
        const scoreA = m.scoreA || 0; const scoreB = m.scoreB || 0;
        const teamAWon = scoreA > scoreB;

        m.teamA.forEach(id => {
            if (map[id]) {
                if (teamAWon) map[id].win++; else map[id].lose++;
                map[id].scoreDiff += (scoreA - scoreB);
            }
        });
        m.teamB.forEach(id => {
            if (map[id]) {
                if (!teamAWon) map[id].win++; else map[id].lose++;
                map[id].scoreDiff += (scoreB - scoreA);
            }
        });
    });

    let list = Object.entries(map).map(([id, val]) => ({ id: parseInt(id), ...val }));
    list.sort((a, b) => b.win - a.win || (b.win/(b.win+b.lose || 1)) - (a.win/(a.win+a.lose || 1)) || b.scoreDiff - a.scoreDiff);

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-slate-400">출석자가 없습니다.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((p, idx) => {
        const total = p.win + p.lose;
        const rate = total > 0 ? Math.round((p.win / total) * 100) : 0;
        const isHot = idx === 0 && p.win > 0;
        const fireStyle = isHot ? "hot-player-card text-red-600 font-black" : "hover:bg-slate-50";

        return `
            <tr class="${fireStyle} transition-all">
                <td class="py-2.5 px-1 font-bold">${p.name}${isHot ? ' 🔥' : ''}</td>
                <td class="py-2.5 px-1 font-mono">${p.win}승 ${p.lose}패</td>
                <td class="py-2.5 px-1 font-mono text-indigo-600 font-extrabold">${rate}%</td>
                <td class="py-2.5 px-1 font-mono font-bold text-slate-700">${p.scoreDiff > 0 ? '+' + p.scoreDiff : p.scoreDiff}</td>
            </tr>
        `;
    }).join('');
}

let targetMatchIdForScore = null;
function openScoreModal(mId) {
    targetMatchIdForScore = mId;
    const currentMatches = window.currentActiveSession.currentMatches || [];
    const m = currentMatches.find(x => x.id === mId);
    if (!m) return;

    document.getElementById('modalTeamANames').innerText = getNamesFromIds(m.teamA, m.teamANames).join(', ');
    document.getElementById('modalTeamBNames').innerText = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
    document.getElementById('inputScoreA').value = '';
    document.getElementById('inputScoreB').value = '';
    document.getElementById('scoreModal').classList.remove('hidden');
}

if(document.getElementById('btnCloseScoreModal')) {
    document.getElementById('btnCloseScoreModal').onclick = () => document.getElementById('scoreModal').classList.add('hidden');
}

if(document.getElementById('btnSubmitMatchScore')) {
    document.getElementById('btnSubmitMatchScore').onclick = function() {
        const sA = parseInt(document.getElementById('inputScoreA').value);
        const sB = parseInt(document.getElementById('inputScoreB').value);

        if (isNaN(sA) || isNaN(sB)) { alert("🎯 점수를 입력하세요!"); return; }
        if (sA === sB) { alert("🏸 배드민턴은 무승부가 없습니다! 최종 듀스 스코어로 입력해 주세요."); return; }

        const s = window.currentActiveSession;
        let currentMatches = s.currentMatches || [];
        let historyLog = s.historyLog || [];
        let statsLog = s.statsLog || {};

        const mIdx = currentMatches.findIndex(x => x.id === targetMatchIdForScore);
        if (mIdx === -1) return;

        let match = currentMatches[mIdx];
        match.scoreA = sA; match.scoreB = sB; match.status = "완료";

        historyLog.push({ ...match, timestamp: Date.now() });
        currentMatches = currentMatches.filter(x => x.id !== targetMatchIdForScore);

        const winTeamA = sA > sB;
        const rA = winTeamA ? 1 : 0; const rB = winTeamA ? 0 : 1;

        let sumMmrA = 0; let sumMmrB = 0;
        match.teamA.forEach(id => { sumMmrA += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
        match.teamB.forEach(id => { sumMmrB += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });

        const avgMmrA = sumMmrA / 2; const avgMmrB = sumMmrB / 2;
        const expA = 1 / (1 + Math.pow(10, (avgMmrB - avgMmrA) / 400));
        const expB = 1 / (1 + Math.pow(10, (avgMmrA - avgMmrB) / 400));

        const K = 32;
        const deltaA = Math.round(K * (rA - expA));
        const deltaB = Math.round(K * (rB - expB));

        [...match.teamA, ...match.teamB].forEach(id => { if(!statsLog[id]) statsLog[id] = { win: 0, lose: 0, delta: 0 }; });
        match.teamA.forEach(id => { if(winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaA; });
        match.teamB.forEach(id => { if(!winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaB; });

        document.getElementById('scoreModal').classList.add('hidden');
        
        update(ref(db, `sessions/${currentSessionKey}`), {
            currentMatches: currentMatches,
            historyLog: historyLog,
            statsLog: statsLog
        }).then(() => {
            alert("🏆 정산 완료!");
            recalculateLiveQueueMatch();
        });
    };
}

function executeLocalRecordSearch(queryName) {
    const container = document.getElementById('localSearchResultContainer');
    if(!container || window.allSystemPlayers.length === 0) return;
    const query = queryName ? queryName.trim() : "";
    if(!query) { container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">이름을 입력하세요.</div>`; return; }

    localStorage.setItem("my_badminton_name", query);

    const historyLog = window.currentActiveSession ? (window.currentActiveSession.historyLog || []) : [];
    const filtered = historyLog.filter(m => {
        return getNamesFromIds(m.teamA, m.teamANames).includes(query) || getNamesFromIds(m.teamB, m.teamBNames).includes(query);
    }).reverse();

    if(filtered.length === 0) {
        container.innerHTML = `<div class="text-center py-4 text-slate-400 text-[11px]">🔍 기록이 없습니다.</div>`;
        return;
    }

    container.innerHTML = filtered.map(m => {
        const aNames = getNamesFromIds(m.teamA, m.teamANames); const bNames = getNamesFromIds(m.teamB, m.teamBNames);
        const isMyTeamA = aNames.includes(query);
        const isAmIWinner = (isMyTeamA && m.scoreA > m.scoreB) || (!isMyTeamA && m.scoreB > m.scoreA);

        return `
            <div class="bg-slate-50 border border-slate-200 p-2 rounded-xl flex justify-between items-center text-[11px]">
                <div class="space-y-0.5">
                    <span class="font-bold ${isAmIWinner ? 'text-emerald-600' : 'text-slate-500'}">${isAmIWinner ? '🏆 승리' : '패배'}</span>
                    <div class="text-slate-700 font-medium">${aNames.join(', ')} VS ${bNames.join(', ')}</div>
                </div>
                <div class="font-mono font-black text-slate-600">${m.scoreA}:${m.scoreB}</div>
            </div>
        `;
    }).join('');
}

function executeGlobalRecordSearch() {
    const input = document.getElementById('inputGlobalSearchPlayer');
    const container = document.getElementById('globalSearchResultContainer');
    if (!input || !container || window.allSystemPlayers.length === 0) return;
    const query = input.value.trim();
    if (!query) { alert("회원 이름을 입력하세요!"); return; }

    container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">아카이브 검색 중...</div>`;

    onValue(ref(db, 'sessions'), (snapshot) => {
        const sessionsData = snapshot.val();
        if (!sessionsData) return;
        let allMatched = [];

        Object.entries(sessionsData).forEach(([sKey, s]) => {
            (s.historyLog || []).forEach(m => {
                const a = getNamesFromIds(m.teamA, m.teamANames); const b = getNamesFromIds(m.teamB, m.teamBNames);
                if (a.includes(query) || b.includes(query)) {
                    allMatched.push({ ...m, computedANames: a, computedBNames: b, title: s.title });
                }
            });
        });

        if (allMatched.length === 0) {
            container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">기록이 없습니다.</div>`; return;
        }

        container.innerHTML = allMatched.reverse().map(m => {
            return `
                <div class="bg-slate-50/80 border border-slate-200 p-2.5 rounded-xl text-xs flex justify-between items-center">
                    <div>
                        <div class="text-[10px] font-black text-indigo-600">${m.title}</div>
                        <div class="font-bold text-slate-800">${m.computedANames.join(', ')} VS ${m.computedBNames.join(', ')}</div>
                    </div>
                    <div class="font-mono font-black text-slate-900">${m.scoreA} : ${m.scoreB}</div>
                </div>
            `;
        }).join('');
    }, { onlyOnce: true });
}

// 📡 DOM 로드 직후 대문 및 세션 스위처 입구 통합 구동
if (document.getElementById('globalRankTableBody')) {
    window.initDashboardPage();
} else if (document.getElementById('liveCourtsContainer')) {
    window.initSessionPage();
}
