import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ⚠️ 관리자님의 실제 파이어베이스 주소 및 키값을 정확히 유지해 주세요!
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

window.isAdminMode = localStorage.getItem("badminton_admin_login") === "true";
window.currentActiveSession = null;
window.currentSessionKey = null;
let activeChartInstance = null;
window.allSystemPlayers = [];

// 📡 파이어베이스 /players 창고 실시간 리스너 연결
onValue(ref(db, 'players'), (snapshot) => {
    const data = snapshot.val();
    if (data) {
        window.allSystemPlayers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
        window.allSystemPlayers.sort((a, b) => a.id - b.id);
        
        // 데이터 도달 시 대문 혹은 세션 동기화 주입
        if (document.getElementById('globalRankTableBody') && window.currentActiveSession === null) {
            const sessionsRef = ref(db, 'sessions');
            onValue(sessionsRef, (snap) => { if(snap.val()) calculateGlobalLeaderboard(snap.val()); }, { onlyOnce: true });
        }
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
// 🏢 대문 통합 제어 모듈
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
                } else { alert("❌ 비밀번호 불일치!"); return; }
            } else {
                isAdminMode = false;
                localStorage.setItem("badminton_admin_login", "false");
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
            const displayScore = s.targetScore ? `${s.targetScore}점 제` : "25점 제";

            return `
                <div class="flex items-center justify-between bg-white border border-slate-200 p-4 rounded-xl shadow-3xs hover:border-indigo-400 transition-all">
                    <a href="./session.html?id=${id}${isAdminMode ? '&admin=true' : ''}" class="block flex-1 space-y-1">
                        <div class="flex items-center gap-2">
                            <h3 class="text-sm font-black text-slate-900">${s.title}</h3>
                            <span class="text-[9px] font-black px-1.5 py-0.5 rounded border ${badgeStyle}">${s.status}</span>
                        </div>
                        <p class="text-[11px] text-slate-400 font-mono">📅 정모일: ${displayDate} • 🎯 ${displayScore} • 참여: ${s.attendees ? s.attendees.length : 0}명</p>
                    </a>
                    ${delBtn}
                </div>
            `;
        }).join('');

        document.querySelectorAll('.btn-delete-session').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                const sid = this.getAttribute('data-id');
                if (confirm(`해당 정모방을 삭제하시겠습니까?`)) {
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
            // 🎯 수동 커스텀 점수 수집 기어 파싱
            const scoreVal = parseInt(document.getElementById('newSessionTargetScore').value) || 25;
            const isTest = document.getElementById('checkboxTestMode').checked;

            const now = new Date();
            const timeKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

            set(ref(db, `sessions/${timeKey}`), {
                status: "예정",
                title: title,
                date: dateVal,
                targetScore: scoreVal,
                courts: 2, 
                isTestMode: isTest,
                createdAt: Date.now()
            }).then(() => {
                alert(`🚀 정모방 개설 성공!`);
                window.location.reload();
            });
        };
    }

    const btnGlobalSrc = document.getElementById('btnGlobalSearchRecord');
    if (btnGlobalSrc) btnGlobalSrc.onclick = () => { executeGlobalRecordSearch(); };
};

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
        return `
            <tr class="hover:bg-indigo-50/40 transition-colors cursor-pointer btn-open-trend-chart" data-id="${p.id}" data-name="${p.name}" data-timeline="${JSON.stringify(p.historyTimeline)}">
                <td class="py-2.5 px-4 text-center font-black text-slate-400 font-mono">${idx + 1}</td>
                <td class="py-2.5 px-4 font-black text-indigo-950">${p.name} <span class="text-[10px] text-slate-400 font-normal">(${p.tier}조)</span></td>
                <td class="py-2.5 px-4 text-center font-mono text-slate-500">${total}판</td>
                <td class="py-2.5 px-4 text-center font-mono text-slate-600">${p.win}승 ${p.lose}패</td>
                <td class="py-2.5 px-4 text-center font-mono font-black text-indigo-600">${rate}%</td>
                <td class="py-2.5 px-4 text-right font-black font-mono text-slate-900">${currentMmr}점</td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('.btn-open-trend-chart').forEach(tr => {
        tr.onclick = function() {
            const pId = this.getAttribute('data-id'); const pName = this.getAttribute('data-name');
            const timeline = JSON.parse(this.getAttribute('data-timeline'));
            document.getElementById('modalPlayerTitle').innerText = `🏆 [${pName}] 회원 MMR 성장 곡선`;
            document.getElementById('chartModal').classList.remove('hidden');
            const chartData = timeline.length > 0 ? timeline.slice(-7) : [aggregateMap[pId].baseMmr];
            const labels = chartData.map((_, i) => `${i + 1}회차`);
            const ctx = document.getElementById('playerTrendChart').getContext('2d');
            if (activeChartInstance) activeChartInstance.destroy();
            activeChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{ data: chartData, borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.05)', borderWidth: 3, fill: true }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        };
    });
    const closeBtn = document.getElementById('btnCloseModal');
    if(closeBtn) closeBtn.onclick = () => document.getElementById('chartModal').classList.add('hidden');
};

// ==========================================
// 🏟️ 특정 정모 세션 제어 라이브 채널
// ==========================================
window.initSessionPage = function() {
    const urlParams = new URLSearchParams(window.location.search);
    window.currentSessionKey = urlParams.get('id');
    if (!window.currentSessionKey) return;

    if(urlParams.get('admin') === 'true') {
        isAdminMode = true;
        localStorage.setItem("badminton_admin_login", "true");
    }

    const sessionRef = ref(db, `sessions/${window.currentSessionKey}`);
    onValue(sessionRef, (snapshot) => {
        const s = snapshot.val();
        if (!s) return;
        window.currentActiveSession = s;

        // 🎯 [요구 3 반영] 관리자 실시간 기어 환경박스 바인딩 제어
        const configBox = document.getElementById('adminConfigBox');
        if(configBox && isAdminMode) {
            configBox.classList.remove('hidden'); configBox.classList.add('flex');
            const selCourts = document.getElementById('selectLiveCourts');
            const inpScore = document.getElementById('inputLiveTargetScore');
            if(selCourts) selCourts.value = s.courts || 2;
            if(inpScore) inpScore.value = s.targetScore || 25;
            
            // 즉석 변경 이벤트 탑재
            selCourts.onchange = function() { update(sessionRef, { courts: parseInt(this.value) }).then(() => recalculateLiveQueueMatch()); };
            inpScore.onchange = function() { update(sessionRef, { targetScore: parseInt(this.value) || 25 }); };
        }

        renderAttendanceBox(s);
        renderLiveCourtsGrid(s);
        renderSessionRankTable(s);
        
        // 🎯 [요구 5 반영] 검색창 입력 대기 리스너 결합
        const searchInput = document.getElementById('inputLocalSearchPlayer');
        if(searchInput) {
            if(!searchInput.value) searchInput.value = localStorage.getItem("my_badminton_name") || "";
            executeLocalRecordSearch(searchInput.value);
            searchInput.oninput = function() { executeLocalRecordSearch(this.value); };
        }
    });

    // 📡 피드백 동기화 대기선 가동
    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            window.allSystemPlayers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
            window.allSystemPlayers.sort((a, b) => a.id - b.id);
            buildIdentityDropdown(); // 👤 [요구 6 복원] 명단 입고 직후 내 이름 셀렉터 드롭다운 그리기 호출
            if(window.currentActiveSession) {
                renderAttendanceBox(window.currentActiveSession);
                renderSessionRankTable(window.currentActiveSession);
            }
        }
    });
};

// 👤 [요구 6 복원] 상단 내 이름 바인딩 시스템 어태치먼트
function buildIdentityDropdown() {
    const select = document.getElementById('selectMyIdentity');
    if (!select || select.options.length > 1) return;
    
    window.allSystemPlayers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.innerText = `${p.name} (${p.tier}조)`;
        select.appendChild(opt);
    });

    const savedName = localStorage.getItem("my_badminton_name");
    if (savedName) {
        select.value = savedName;
    }

    select.onchange = function() {
        const val = this.value;
        localStorage.setItem("my_badminton_name", val);
        const searchInput = document.getElementById('inputLocalSearchPlayer');
        if(searchInput) { searchInput.value = val; executeLocalRecordSearch(val); }
    };
}

// 🎯 [요구 4 반영] 키보드 초고속 서치바 & 동명이인 나이 분기 타격기 엔진
if(document.getElementById('inputKeyboardAttendance')) {
    document.getElementById('inputKeyboardAttendance').onkeydown = function(e) {
        if(e.key === 'Enter') {
            e.preventDefault();
            const query = this.value.trim();
            if(!query) return;

            // 전체 시스템 명단에서 동명이인 전량 필터 스캔
            const matched = window.allSystemPlayers.filter(x => x.name === query);
            if(matched.length === 0) { alert("❌ 명단에 등록되지 않은 이름입니다."); return; }

            if(matched.length > 1) {
                // ⚠️ 동명이인이 발견되면 안내 패널 레이어를 열어 강제 선택 유도 분기 가동
                const box = document.getElementById('duplicateSelectionBox');
                const listWrapper = document.getElementById('duplicateListWrapper');
                box.classList.remove('hidden');
                
                listWrapper.innerHTML = matched.map(p => {
                    // 명단 필드 내의 나이(age) 속성을 매핑 처리 (없으면 ID 출력 보정)
                    const ageLabel = p.age ? `${p.age}세` : `ID ${p.id}번`;
                    return `<button data-id="${p.id}" class="btn-resolve-dup text-left w-full bg-slate-50 hover:bg-indigo-50 border p-1.5 font-bold rounded-lg text-[11px] text-slate-800">${p.name} (${ageLabel} / ${p.tier}조)</button>`;
                }).join('');

                document.querySelectorAll('.btn-resolve-dup').forEach(btn => {
                    btn.onclick = function() {
                        commitAttendanceAction(parseInt(this.getAttribute('data-id')));
                        box.classList.add('hidden');
                        document.getElementById('inputKeyboardAttendance').value = "";
                    };
                });
            } else {
                // 단독 고유 플레이어일 경우 엔터 즉시 소환 출석 처리 완료
                commitAttendanceAction(matched[0].id);
                this.value = "";
            }
        }
    };
}

function commitAttendanceAction(pId) {
    const s = window.currentActiveSession;
    if(!s) return;
    let nextAttendees = s.attendees ? [...s.attendees] : [];
    let nextRest = s.restPlayers ? [...s.restPlayers] : [];

    if (!nextAttendees.includes(pId)) {
        nextAttendees.push(pId);
    } else {
        if (!nextRest.includes(pId)) nextRest.push(pId);
        else { nextRest = nextRest.filter(x => x !== pId); nextAttendees = nextAttendees.filter(x => x !== pId); }
    }
    update(ref(db, `sessions/${window.currentSessionKey}`), { attendees: nextAttendees, restPlayers: nextRest }).then(() => recalculateLiveQueueMatch());
}

function renderAttendanceBox(s) {
    const attendees = s.attendees || [];
    const restList = s.restPlayers || [];
    const container = document.getElementById('attendanceTogglerBox');
    
    if (container && window.allSystemPlayers.length > 0) {
        if(s.status === "종료") {
            container.innerHTML = `<div class="text-[11px] text-slate-400 py-2 w-full text-center">🔐 정모 종료로 출석부가 잠겼습니다.</div>`;
        } else {
            container.innerHTML = window.allSystemPlayers.map(p => {
                const isChecked = attendees.includes(p.id); const isResting = restList.includes(p.id);
                let btnStyle = isChecked ? "bg-indigo-600 text-white font-black" : "bg-slate-100 text-slate-600 border border-slate-200";
                if(isResting) btnStyle = "bg-amber-100 text-amber-800 border-amber-300 line-through";
                return `<button data-id="${p.id}" class="btn-toggle-attend text-[10px] px-2 py-0.5 rounded-lg font-medium transition cursor-pointer ${btnStyle}">${p.name}</button>`;
            }).join('');

            document.querySelectorAll('.btn-toggle-attend').forEach(btn => {
                btn.onclick = function() { commitAttendanceAction(parseInt(this.getAttribute('data-id'))); };
            });
        }
    }

    // 🎯 [요구 8 반영] 대기열 제외 쉼터 복귀 처리기 가드
    const restContainer = document.getElementById('restPlayersContainer');
    if (restContainer) {
        if (restList.length === 0) {
            restContainer.innerHTML = `<div class="text-[10px] text-slate-400 italic py-1">제외자가 없습니다.</div>`;
        } else {
            restContainer.innerHTML = restList.map(id => {
                const p = window.allSystemPlayers.find(x => x.id === id);
                const backBtn = s.status !== "종료" ? `<span class="bg-amber-500 text-white font-sans font-black text-[9px] px-1 rounded-sm ml-1 cursor-pointer">복귀</span>` : '';
                return `<div data-id="${id}" class="btn-return-queue flex items-center bg-amber-50 border border-amber-200 text-amber-800 font-bold px-2 py-0.5 rounded-lg text-[10px]">${p ? p.name : id}${backBtn}</div>`;
            }).join('');

            if(s.status !== "종료") {
                document.querySelectorAll('.btn-return-queue').forEach(div => {
                    div.onclick = function() {
                        const pId = parseInt(this.getAttribute('data-id'));
                        const nextRest = restList.filter(x => x !== pId);
                        update(ref(db, `sessions/${window.currentSessionKey}`), { restPlayers: nextRest }).then(() => recalculateLiveQueueMatch());
                    };
                });
            }
        }
    }

    // 🎯 [요구 5 반영] 매칭 가동 전(예정 상태), 대기실 인원 누적 전적/승률 5경기 이력 대형 현황판 렌더링 가동
    const beforeStatsBox = document.getElementById('beforeStartStatsBox');
    const beforeListContainer = document.getElementById('beforeStartPlayersList');
    if(beforeStatsBox && beforeListContainer) {
        if(s.status !== "예정") {
            beforeStatsBox.classList.add('hidden'); // 정모가 시작되면 이 보드는 자동 소멸 숨김
        } else {
            beforeStatsBox.classList.remove('hidden');
            if(attendees.length === 0) {
                beforeListContainer.innerHTML = `<div class="text-center py-4 text-slate-400">출석체크된 대기 인원이 아직 없습니다.</div>`;
            } else {
                beforeListContainer.innerHTML = attendees.map(id => {
                    const p = window.allSystemPlayers.find(x => x.id === id);
                    if(!p) return '';
                    return `
                        <div class="flex justify-between items-center py-2 text-slate-700">
                            <span class="font-black text-slate-900">${p.name} <span class="text-[9px] text-indigo-500 font-bold">(${p.tier}조)</span></span>
                            <div class="font-mono text-[10px] space-x-2 text-slate-500">
                                <span>📈 MMR: <span class="text-slate-900 font-bold">${p.displayMmr}</span></span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    }
}

// ==========================================
// 🎯 [요구 2 반영] 이긴팀 녹색, 진팀 적색 점수판 테두리 이식 모듈
// ==========================================
function renderLiveCourtsGrid(s) {
    const liveContainer = document.getElementById('liveCourtsContainer');
    if (!liveContainer) return;

    const currentMatches = s.currentMatches || [];
    const historyLog = s.historyLog || [];

    if (s.status === "예정") {
        liveContainer.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">대기중 채널입니다. 관리자가 정모 매칭 가동 시작 버튼을 누르면 추천 대진표 레이어가 개방됩니다.</div>`;
        return;
    }

    // [개선 반영] 종료 상태 아카이브 전광판 리스트
    if(s.status === "종료") {
        if(historyLog.length === 0) {
            liveContainer.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">오늘 마감된 경기 일지가 없습니다.</div>`;
        } else {
            liveContainer.innerHTML = [...historyLog].reverse().map((m, idx) => {
                const aNames = getNamesFromIds(m.teamA, m.teamANames).join(', ');
                const bNames = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
                
                // 🎯 [요구 2 반영] 마감 카드 스코어 좌우 판독 테두리 주입 연산
                const winA = m.scoreA > m.scoreB;
                const borderA = winA ? "border-2 border-emerald-400 bg-emerald-50/10 shadow-sm" : "border border-rose-200 bg-rose-50/10";
                const borderB = !winA ? "border-2 border-emerald-400 bg-emerald-50/10 shadow-sm" : "border border-rose-200 bg-rose-50/10";

                return `
                    <div class="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-3xs space-y-2.5">
                        <div class="text-[10px] font-black font-mono text-slate-400">🏁 제 ${historyLog.length - idx}경기 최종 스코어</div>
                        <div class="grid grid-cols-2 gap-3 text-center text-xs">
                            <div class="p-2 rounded-xl flex justify-between items-center font-bold ${borderA}">
                                <span class="truncate">${aNames}</span> <span class="font-mono font-black">${m.scoreA}</span>
                            </div>
                            <div class="p-2 rounded-xl flex justify-between items-center font-bold ${borderB}">
                                <span class="font-mono font-black">${m.scoreB}</span> <span class="truncate">${bNames}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
        return;
    }

    if (currentMatches.length === 0) {
        liveContainer.innerHTML = `<div class="text-center py-10 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">대기열 우선순위 연산 중...</div>`;
        return;
    }

    // 진행중 추천 매치 카드 조립
    liveContainer.innerHTML = currentMatches.map((m, idx) => {
        if (m.status === "완료") return '';
        
        const aNames = getNamesFromIds(m.teamA, m.teamANames).join(', ');
        const bNames = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
        
        const isLive = m.status === "진행중";
        const mainCardBorder = isLive ? "border-2 border-indigo-500 bg-indigo-50/50 shadow-md scale-[1.01]" : "border border-slate-200 bg-white";
        const badge = isLive 
            ? `<span class="bg-emerald-500 text-white text-[9px] font-black px-2 py-0.5 rounded-md animate-pulse">⚡ 진행중</span>`
            : `<span class="bg-indigo-50 text-indigo-700 text-[9px] font-black px-2 py-0.5 rounded-md border border-indigo-100">⏳ 추천대진 ${idx + 1}순위</span>`;

        const ctrlBtn = isLive
            ? `<button data-id="${m.id}" class="btn-open-score bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] px-2.5 py-1.5 rounded-xl transition shadow-xs cursor-pointer">🛑 경기 종료</button>`
            : `<button data-id="${m.id}" class="btn-start-match bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[11px] px-2.5 py-1.5 rounded-xl transition shadow-xs cursor-pointer">▶️ 경기시작</button>`;

        return `
            <div class="rounded-2xl p-4 transition-all space-y-3.5 ${mainCardBorder}">
                <div class="flex justify-between items-center border-b border-slate-100/70 pb-1.5">
                    ${badge}
                    ${ctrlBtn}
                </div>
                <div class="grid grid-cols-7 text-center items-center text-xs font-black text-slate-800">
                    <div class="col-span-3 truncate text-left pl-1 bg-slate-100/60 p-2 rounded-xl border border-slate-200/50">${aNames}</div>
                    <div class="col-span-1 font-mono font-black text-slate-300">VS</div>
                    <div class="col-span-3 truncate text-right pr-1 bg-slate-100/60 p-2 rounded-xl border border-slate-200/50">${bNames}</div>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.btn-start-match').forEach(btn => {
        btn.onclick = function() {
            const mId = this.getAttribute('data-id');
            const target = currentMatches.find(x => x.id === mId);
            if(target) { target.status = "진행중"; update(ref(db, `sessions/${window.currentSessionKey}`), { currentMatches: currentMatches }); }
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
    
    // 🎯 [요구 7 반영] 사용 코트 수 동적 추출 
    const maxCourts = s.courts || 2; 

    const lockedMatches = currentMatches.filter(m => m.status === "진행중" || m.status === "완료");
    let busyIds = new Set();
    lockedMatches.forEach(m => { m.teamA.forEach(id => busyIds.add(id)); m.teamB.forEach(id => busyIds.add(id)); });
    restList.forEach(id => busyIds.add(id));

    let availableIds = attendees.filter(id => !busyIds.has(id)); 
    let playCounts = {};
    attendees.forEach(id => playCounts[id] = 0);
    historyLog.forEach(m => { [...m.teamA, ...m.teamB].forEach(id => { if(playCounts[id] !== undefined) playCounts[id]++; }); });

    let queue = availableIds.sort((a, b) => (playCounts[a] || 0) - (playCounts[b] || 0));
    let nextMatches = [...lockedMatches];
    
    // 🎯 설정된 코트수만큼 루프 캡 상한선 설정
    const targetSlots = maxCourts - nextMatches.length;

    for (let i = 0; i < targetSlots; i++) {
        if (queue.length >= 4) {
            const p1 = queue.shift(); const p2 = queue.shift(); const p3 = queue.shift(); const p4 = queue.shift();
            nextMatches.push({
                id: `m_${Date.now()}_${i}`, status: "대기",
                teamA: [p1, p2], teamB: [p3, p4],
                teamANames: getNamesFromIds([p1, p2]), teamBNames: getNamesFromIds([p3, p4])
            });
        }
    }
    update(ref(db, `sessions/${window.currentSessionKey}`), { currentMatches: nextMatches });
}

function renderSessionRankTable(s) {
    const tbody = document.getElementById('sessionLiveRankTableBody');
    if (!tbody || window.allSystemPlayers.length === 0) return;
    const attendees = s.attendees || []; const historyLog = s.historyLog || [];

    let map = {};
    attendees.forEach(id => { const p = window.allSystemPlayers.find(x => x.id === id); map[id] = { name: p ? p.name : id, win: 0, lose: 0, scoreDiff: 0 }; });

    historyLog.forEach(m => {
        const scoreA = m.scoreA || 0; const scoreB = m.scoreB || 0; const teamAWon = scoreA > scoreB;
        m.teamA.forEach(id => { if (map[id]) { if (teamAWon) map[id].win++; else map[id].lose++; map[id].scoreDiff += (scoreA - scoreB); } });
        m.teamB.forEach(id => { if (map[id]) { if (!teamAWon) map[id].win++; else map[id].lose++; map[id].scoreDiff += (scoreB - scoreA); } });
    });

    let list = Object.entries(map).map(([id, val]) => ({ id: parseInt(id), ...val }));
    list.sort((a, b) => b.win - a.win || (b.win/(b.win+b.lose || 1)) - (a.win/(a.win+a.lose || 1)) || b.scoreDiff - a.scoreDiff);

    if (list.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="py-4 text-slate-400">참가자가 없습니다.</td></tr>`; return; }
    tbody.innerHTML = list.map((p, idx) => {
        const total = p.win + p.lose; const rate = total > 0 ? Math.round((p.win / total) * 100) : 0;
        const isHot = idx === 0 && p.win > 0;
        return `<tr class="${isHot ? 'hot-player-card text-red-600 font-black' : 'hover:bg-slate-50'}"><td class="py-2 px-1 font-bold">${p.name}${isHot ? ' 🔥' : ''}</td><td class="py-2 px-1 font-mono">${p.win}승 ${p.lose}패</td><td class="py-2 px-1 font-mono text-indigo-600 font-black">${rate}%</td><td class="py-2 px-1 font-mono font-bold">${p.scoreDiff > 0 ? '+' + p.scoreDiff : p.scoreDiff}</td></tr>`;
    }).join('');
}

let scoreModalTargetMatchId = null;
function openScoreModal(mId) {
    scoreModalTargetMatchId = mId;
    const m = window.currentActiveSession.currentMatches.find(x => x.id === mId);
    if (!m) return;
    document.getElementById('modalTeamANames').innerText = getNamesFromIds(m.teamA, m.teamANames).join(', ');
    document.getElementById('modalTeamBNames').innerText = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
    document.getElementById('inputScoreA').value = ''; document.getElementById('inputScoreB').value = '';
    document.getElementById('scoreModal').classList.remove('hidden');
}

if(document.getElementById('btnSubmitMatchScore')) {
    document.getElementById('btnSubmitMatchScore').onclick = function() {
        const sA = parseInt(document.getElementById('inputScoreA').value); const sB = parseInt(document.getElementById('inputScoreB').value);
        if (isNaN(sA) || isNaN(sB)) { alert("점수를 기입하세요!"); return; }

        const s = window.currentActiveSession;
        let currentMatches = s.currentMatches || []; let historyLog = s.historyLog || []; let statsLog = s.statsLog || {};
        const mIdx = currentMatches.findIndex(x => x.id === scoreModalTargetMatchId); if (mIdx === -1) return;

        let match = currentMatches[mIdx]; match.scoreA = sA; match.scoreB = sB; match.status = "완료";
        historyLog.push({ ...match, timestamp: Date.now() });
        currentMatches = currentMatches.filter(x => x.id !== scoreModalTargetMatchId);

        const winTeamA = sA > sB;
        const rA = winTeamA ? 1 : 0; const rB = winTeamA ? 0 : 1;
        let sumA = 0; let sumB = 0;
        match.teamA.forEach(id => { sumA += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
        match.teamB.forEach(id => { sumB += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
        const expA = 1 / (1 + Math.pow(10, ((sumB/2) - (sumA/2)) / 400));
        const expB = 1 / (1 + Math.pow(10, ((sumA/2) - (sumB/2)) / 400));

        const deltaA = Math.round(32 * (rA - expA)); const deltaB = Math.round(32 * (rB - expB));
        [...match.teamA, ...match.teamB].forEach(id => { if(!statsLog[id]) statsLog[id] = { win: 0, lose: 0, delta: 0 }; });
        match.teamA.forEach(id => { if(winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaA; });
        match.teamB.forEach(id => { if(!winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaB; });

        document.getElementById('scoreModal').classList.add('hidden');
        update(ref(db, `sessions/${window.currentSessionKey}`), { currentMatches, historyLog, statsLog }).then(() => { recalculateLiveQueueMatch(); });
    };
}

function executeLocalRecordSearch(queryName) {
    const container = document.getElementById('localSearchResultContainer');
    if(!container || window.allSystemPlayers.length === 0) return;
    const query = queryName ? queryName.trim() : "";
    if(!query) { container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">이름 검색 대기 중</div>`; return; }

    localStorage.setItem("my_badminton_name", query);
    const historyLog = window.currentActiveSession ? (window.currentActiveSession.historyLog || []) : [];
    const filtered = historyLog.filter(m => getNamesFromIds(m.teamA, m.teamANames).includes(query) || getNamesFromIds(m.teamB, m.teamBNames).includes(query)).reverse();

    if(filtered.length === 0) { container.innerHTML = `<div class="text-center py-4 text-slate-400 text-[11px]">기록이 없습니다.</div>`; return; }
    
    // 🎯 [요구 2 반영] 당일 마감 조회 뷰어 내 팀 스코어 컬러 링 테두리 교정
    container.innerHTML = filtered.map(m => {
        const aNames = getNamesFromIds(m.teamA, m.teamANames); const bNames = getNamesFromIds(m.teamB, m.teamBNames);
        const isMyTeamA = aNames.includes(query);
        const winA = m.scoreA > m.scoreB;
        const isAmIWinner = (isMyTeamA && winA) || (!isMyTeamA && !winA);
        
        const borderA = winA ? "border border-emerald-300 bg-emerald-50/50" : "border border-rose-200 bg-rose-50/50";
        const borderB = !winA ? "border border-emerald-300 bg-emerald-50/50" : "border border-rose-200 bg-rose-50/50";

        return `
            <div class="bg-white border rounded-xl p-2.5 space-y-2 text-[11px] shadow-3xs">
                <div class="flex justify-between items-center font-mono text-[10px] text-slate-400">
                    <span>⏱️ 정산 완료 매치</span>
                    <span class="font-black ${isAmIWinner ? 'text-emerald-600':'text-rose-500'}">${isAmIWinner ? 'WIN 🏆':'LOSE'}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-center font-bold text-slate-700">
                    <div class="p-1 rounded-lg flex justify-between ${borderA}"><span>${aNames.join(',')}</span> <span>${m.scoreA}</span></div>
                    <div class="p-1 rounded-lg flex justify-between ${borderB}"><span>${m.scoreB}</span> <span>${bNames.join(',')}</span></div>
                </div>
            </div>
        `;
    }).join('');
}

function executeGlobalRecordSearch() {
    const input = document.getElementById('inputGlobalSearchPlayer'); const container = document.getElementById('globalSearchResultContainer');
    if (!input || !container || window.allSystemPlayers.length === 0) return;
    const query = input.value.trim(); if (!query) return;

    onValue(ref(db, 'sessions'), (snapshot) => {
        const sessionsData = snapshot.val(); if (!sessionsData) return;
        let allMatched = [];
        Object.entries(sessionsData).forEach(([sKey, s]) => {
            (s.historyLog || []).forEach(m => {
                const a = getNamesFromIds(m.teamA, m.teamANames); const b = getNamesFromIds(m.teamB, m.teamBNames);
                if (a.includes(query) || b.includes(query)) allMatched.push({ ...m, computedANames: a, computedBNames: b, title: s.title });
            });
        });
        if (allMatched.length === 0) { container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">기록 없음</div>`; return; }
        container.innerHTML = allMatched.reverse().map(m => {
            return `<div class="bg-slate-50 border p-2 rounded-xl text-xs flex justify-between items-center"><div><div class="text-[9px] text-indigo-600 font-bold">${m.title}</div><div class="font-bold">${m.computedANames.join(', ')} VS ${m.computedBNames.join(', ')}</div></div><div class="font-mono font-black">${m.scoreA} : ${m.scoreB}</div></div>`;
        }).join('');
    }, { onlyOnce: true });
}

if (document.getElementById('globalRankTableBody')) { window.initDashboardPage(); } 
else if (document.getElementById('selectMyIdentity')) { window.initSessionPage(); }
