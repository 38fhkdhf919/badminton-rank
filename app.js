import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

window.isAdminMode = localStorage.getItem("badminton_admin_login") === "true";
window.currentActiveSession = null;
window.currentSessionKey = null;
let activeChartInstance = null;
window.allSystemPlayers = [];

// 📡 파이어베이스 /players 실시간 원격 백엔드 연동 수신부
onValue(ref(db, 'players'), (snapshot) => {
    const data = snapshot.val();
    if (data) {
        window.allSystemPlayers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
        window.allSystemPlayers.sort((a, b) => a.id - b.id);
        console.log("📡 회원 명단 파싱 성공:", window.allSystemPlayers.length, "명");
        
        // 데이터 수신 시 현재 활성화된 화면 컨텍스트 레이아웃 구조 강제 갱신
        if (document.getElementById('globalRankTableBody') && window.currentSessionKey === null) {
            const sessionsRef = ref(db, 'sessions');
            onValue(sessionsRef, (snap) => { if(snap.val()) calculateGlobalLeaderboard(snap.val()); }, { onlyOnce: true });
        } else if (window.currentSessionKey) {
            buildIdentityDropdown();
            if(window.currentActiveSession) {
                renderAttendanceBox(window.currentActiveSession);
                renderSessionRankTable(window.currentActiveSession);
            }
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
// 🏢 대문 메인 대시보드 통제 코어
// ==========================================
window.initDashboardPage = function() {
    const btnToggle = document.getElementById('btnAdminToggle');
    if (btnToggle) {
        btnToggle.innerText = isAdminMode ? "🔓 관리자 모드 인증 해제" : "🔐 마스터 관리자 인증";
        btnToggle.className = isAdminMode ? "bg-indigo-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition shadow-sm" : "bg-slate-800 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl border border-slate-700 transition shadow-sm";

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
            container.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">방이 없습니다.</div>`;
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
                    <a href="./session.html?id=${id}" class="block flex-1 space-y-1">
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
            const scoreVal = parseInt(document.getElementById('newSessionTargetScore').value) || 25;
            const isTest = document.getElementById('checkboxTestMode').checked;

            const now = new Date();
            const timeKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

            set(ref(db, `sessions/${timeKey}`), {
                status: "예정", title: title, date: dateVal, targetScore: scoreVal, courts: 2, isTestMode: isTest, createdAt: Date.now()
            }).then(() => { alert(`🚀 정모방 생성 성공!`); window.location.reload(); });
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
                    player.win += (log.win || 0); player.lose += (log.lose || 0); player.deltaSum += (log.delta || 0);
                    player.historyTimeline.push(player.baseMmr + player.deltaSum);
                }
            });
        }
    });

    let sortedList = Object.values(aggregateMap).sort((a, b) => (b.baseMmr + b.deltaSum) - (a.baseMmr + a.deltaSum));
    tbody.innerHTML = sortedList.map((p, idx) => {
        const total = p.win + p.lose; const rate = total > 0 ? Math.round((p.win / total) * 100) : 0;
        return `
            <tr class="hover:bg-indigo-50/40 transition-colors cursor-pointer btn-open-trend-chart" data-id="${p.id}" data-name="${p.name}" data-timeline="${JSON.stringify(p.historyTimeline)}">
                <td class="py-2.5 px-4 text-center font-black text-slate-400 font-mono">${idx + 1}</td>
                <td class="py-2.5 px-4 font-black text-indigo-950">${p.name} <span class="text-[10px] text-slate-400 font-normal">(${p.tier}조)</span></td>
                <td class="py-2.5 px-4 text-center font-mono text-slate-500">${total}판</td>
                <td class="py-2.5 px-4 text-center font-mono text-slate-600">${p.win}승 ${p.lose}패</td>
                <td class="py-2.5 px-4 text-center font-mono font-black text-indigo-600">${rate}%</td>
                <td class="py-2.5 px-4 text-right font-black font-mono text-slate-900">${p.baseMmr + p.deltaSum}점</td>
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
                type: 'line', data: { labels: labels, datasets: [{ data: chartData, borderColor: '#4f46e5', borderWidth: 3, fill: false }] },
                options: { responsive: true, maintainAspectRatio: false }
            });
        };
    });
    const closeBtn = document.getElementById('btnCloseModal');
    if(closeBtn) closeBtn.onclick = () => document.getElementById('chartModal').classList.add('hidden');
}

// ==========================================
// 🏟️ 실시간 라이브 정모 전광판 제어실 코어
// ==========================================
window.initSessionPage = function() {
    const btnToggle = document.getElementById('btnAdminToggle');
    if (btnToggle) {
        btnToggle.innerText = isAdminMode ? "🔓 관리자 인증 해제" : "🔐 마스터 관리자 인증";
        btnToggle.className = isAdminMode ? "bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition shadow-sm" : "bg-slate-800 text-slate-200 text-xs font-bold px-3 py-1.5 rounded-xl border transition shadow-sm";

        btnToggle.onclick = function() {
            if (!isAdminMode) {
                if (prompt("🔐 마스터 암호를 기입하세요:") === "1234") { isAdminMode = true; localStorage.setItem("badminton_admin_login", "true"); }
                else { alert("비밀번호 에러!"); return; }
            } else { isAdminMode = false; localStorage.setItem("badminton_admin_login", "false"); }
            window.location.reload();
        };
    }

    const sessionRef = ref(db, `sessions/${window.currentSessionKey}`);
    onValue(sessionRef, (snapshot) => {
        const s = snapshot.val(); if (!s) return;
        window.currentActiveSession = s;

        document.getElementById('sessionMainTitle').innerText = s.title;
        document.getElementById('sessionMetaText').innerText = `📅 정모일: ${s.date || '미정'} • 🎯 목표스코어: ${s.targetScore || 25}점 제`;
        
        const statusBadge = document.getElementById('sessionStatusBadge');
        if(statusBadge) {
            statusBadge.innerText = s.status;
            if(s.status === "진행중") statusBadge.className = "text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border animate-pulse";
            else if(s.status === "종료") statusBadge.className = "text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border";
            else statusBadge.className = "text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border";
        }

        const adminPanel = document.getElementById('adminPanel');
        const btnToggleStatus = document.getElementById('btnToggleStatus');
        if (isAdminMode && adminPanel && btnToggleStatus) {
            adminPanel.classList.remove('hidden'); adminPanel.classList.add('flex');
            btnToggleStatus.innerText = s.status === "예정" ? "▶️ 정모 매칭 가동 시작" : (s.status === "진행중" ? "🛑 오늘 정모 최종 마감/종료" : "🔒 정모 폐쇄됨");
            btnToggleStatus.disabled = s.status === "종료";
            
            btnToggleStatus.onclick = function() {
                if (s.status === "예정") { update(sessionRef, { status: "진행중" }).then(() => recalculateLiveQueueMatch()); } 
                else if (s.status === "진행중") { if (confirm("오늘 정모를 최종 마감 전송하시겠습니까?")) { update(sessionRef, { status: "종료" }); } }
            };
        }

        const keyboardInputWrapper = document.getElementById('adminOnlyAttendanceInputWrapper');
        if(keyboardInputWrapper) keyboardInputWrapper.style.display = (isAdminMode && s.status !== "종료") ? 'block' : 'none';

        const beforeStatsBox = document.getElementById('beforeStartStatsBox');
        const liveStatsWrapper = document.getElementById('liveStatsActiveWrapper');
        if(s.status === "예정") {
            if(beforeStatsBox) beforeStatsBox.style.display = 'block';
            if(liveStatsWrapper) liveStatsWrapper.style.display = 'none';
        } else {
            if(beforeStatsBox) beforeStatsBox.style.display = 'none';
            if(liveStatsWrapper) { liveStatsWrapper.style.display = 'flex'; liveStatsWrapper.classList.remove('hidden'); }
        }

        const configBox = document.getElementById('adminConfigBox');
        if(configBox && isAdminMode) {
            configBox.style.display = 'flex'; configBox.classList.remove('hidden');
            const selCourts = document.getElementById('selectLiveCourts');
            const inpScore = document.getElementById('inputLiveTargetScore');
            if(selCourts) selCourts.value = s.courts || 2;
            if(inpScore) inpScore.value = s.targetScore || 25;
            
            selCourts.onchange = function() { update(sessionRef, { courts: parseInt(this.value) }).then(() => recalculateLiveQueueMatch()); };
            inpScore.onchange = function() { update(sessionRef, { targetScore: parseInt(this.value) || 25 }); };
        }

        renderAttendanceBox(s);
        renderLiveCourtsGrid(s);
        renderSessionRankTable(s);
        
        const searchInput = document.getElementById('inputLocalSearchPlayer');
        if(searchInput) {
            if(!searchInput.value) searchInput.value = localStorage.getItem("my_badminton_name") || "";
            executeLocalRecordSearch(searchInput.value);
            searchInput.oninput = function() { executeLocalRecordSearch(this.value); };
        }
    });

    setTimeout(() => {
        const radioA = document.getElementById('radioWinA'); const radioB = document.getElementById('radioWinB');
        if(radioA && radioB) {
            radioA.onchange = function() { if(this.checked && window.currentActiveSession) { document.getElementById('inputScoreA').value = window.currentActiveSession.targetScore || 25; document.getElementById('inputScoreB').value = ''; } };
            radioB.onchange = function() { if(this.checked && window.currentActiveSession) { document.getElementById('inputScoreB').value = window.currentActiveSession.targetScore || 25; document.getElementById('inputScoreA').value = ''; } };
        }
    }, 800);
};

function buildIdentityDropdown() {
    const select = document.getElementById('selectMyIdentity');
    if (!select || select.options.length > 1 || window.allSystemPlayers.length === 0) return;
    window.allSystemPlayers.forEach(p => {
        const opt = document.createElement('option'); opt.value = p.name; opt.innerText = `${p.name} (${p.tier}조)`; select.appendChild(opt);
    });
    const savedName = localStorage.getItem("my_badminton_name"); if (savedName) select.value = savedName;
    select.onchange = function() {
        localStorage.setItem("my_badminton_name", this.value);
        const searchInput = document.getElementById('inputLocalSearchPlayer');
        if(searchInput) { searchInput.value = this.value; executeLocalRecordSearch(this.value); }
        if(window.currentActiveSession) renderLiveCourtsGrid(window.currentActiveSession);
    };
}

if(document.getElementById('inputKeyboardAttendance')) {
    document.getElementById('inputKeyboardAttendance').onkeydown = function(e) {
        if(e.key === 'Enter') {
            e.preventDefault(); const query = this.value.trim(); if(!query) return;
            const matched = window.allSystemPlayers.filter(x => x.name === query);
            if(matched.length === 0) { alert("❌ 명단 오류"); return; }
            commitAttendanceAction(matched[0].id); this.value = "";
        }
    };
}

function commitAttendanceAction(pId) {
    if(!isAdminMode) return;
    const s = window.currentActiveSession; if(!s) return;
    let nextAttendees = s.attendees ? [...s.attendees] : []; let nextRest = s.restPlayers ? [...s.restPlayers] : [];
    if (!nextAttendees.includes(pId)) nextAttendees.push(pId);
    else { if (!nextRest.includes(pId)) nextRest.push(pId); else { nextRest = nextRest.filter(x => x !== pId); nextAttendees = nextAttendees.filter(x => x !== pId); } }
    update(ref(db, `sessions/${window.currentSessionKey}`), { attendees: nextAttendees, restPlayers: nextRest }).then(() => recalculateLiveQueueMatch());
}

function renderAttendanceBox(s) {
    const attendees = s.attendees || []; const restList = s.restPlayers || [];
    const container = document.getElementById('attendanceTogglerBox');
    const boxTitle = document.getElementById('attendanceBoxTitle');
    const label = document.getElementById('attendeeCountLabel');
    if(!container) return;

    if(s.status === "종료") {
        container.innerHTML = `<div class="text-[11px] text-slate-400 py-2 w-full text-center">🔐 출석부 마감 잠금</div>`;
    } else {
        let targetPlayersPool = [...window.allSystemPlayers];
        if (!isAdminMode) {
            targetPlayersPool = window.allSystemPlayers.filter(p => attendees.includes(p.id) && !restList.includes(p.id));
            if (boxTitle) boxTitle.innerText = "👥 오늘 정모 대기 회원";
            if (label) label.innerText = `${targetPlayersPool.length}명 대기`;
        } else {
            if (boxTitle) boxTitle.innerText = "👥 클럽 전체 회원 명단 (체크용)";
            if (label) label.innerText = `${attendees.length}명 참여`;
        }

        container.innerHTML = targetPlayersPool.map(p => {
            const isChecked = attendees.includes(p.id); const isResting = restList.includes(p.id);
            let btnStyle = isChecked ? "bg-indigo-600 text-white font-black" : "bg-slate-100 text-slate-600 border";
            if(isAdminMode && isResting) btnStyle = "bg-amber-100 text-amber-800 border-amber-300 line-through";
            const disableAttr = isAdminMode ? "" : "disabled";
            return `<button data-id="${p.id}" ${disableAttr} class="btn-toggle-attend text-[10px] px-2 py-0.5 rounded-lg transition m-0.5">${p.name}</button>`;
        }).join('');

        if(isAdminMode) {
            document.querySelectorAll('.btn-toggle-attend').forEach(btn => {
                btn.onclick = function() { commitAttendanceAction(parseInt(this.getAttribute('data-id'))); };
            });
        }
    }

    const restContainer = document.getElementById('restPlayersContainer');
    if (restContainer) {
        if (restList.length === 0) restContainer.innerHTML = `<div class="text-[10px] text-slate-400 italic py-1">제외자 없음</div>`;
        else {
            restContainer.innerHTML = restList.map(id => {
                const p = window.allSystemPlayers.find(x => x.id === id); const backBtn = (s.status !== "종료" && isAdminMode) ? `<span class="bg-amber-500 text-white font-sans font-black text-[9px] px-1 rounded-sm ml-1 cursor-pointer">복귀</span>` : '';
                return `<div data-id="${id}" class="btn-return-queue flex items-center bg-amber-50 border text-amber-800 font-bold px-2 py-0.5 rounded-lg text-[10px]">${p ? p.name : id}${backBtn}</div>`;
            }).join('');
            if(s.status !== "종료" && isAdminMode) {
                document.querySelectorAll('.btn-return-queue').forEach(div => {
                    div.onclick = function() { const pId = parseInt(this.getAttribute('data-id')); const nextRest = restList.filter(x => x !== pId); update(ref(db, `sessions/${window.currentSessionKey}`), { restPlayers: nextRest }).then(() => recalculateLiveQueueMatch()); };
                });
            }
        }
    }

    const beforeListContainer = document.getElementById('beforeStartPlayersList');
    if(beforeListContainer && s.status === "예정") {
        if(attendees.length === 0) { beforeListContainer.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">출석 인원이 없습니다.</div>`; } 
        else {
            let activeObjs = attendees.map(id => window.allSystemPlayers.find(x => x.id === id)).filter(Boolean).sort((a, b) => b.displayMmr - a.displayMmr);
            beforeListContainer.innerHTML = activeObjs.map((p, idx) => `
                <div class="flex justify-between py-2 border-b text-xs">
                    <span class="font-bold">[${idx + 1}등] ${p.name}</span><span class="font-mono text-slate-600">⭐ ${p.displayMmr}점</span>
                </div>`).join('');
        }
    }
}

function renderLiveCourtsGrid(s) {
    const liveContainer = document.getElementById('liveCourtsContainer'); if (!liveContainer) return;
    const currentMatches = s.currentMatches || []; const historyLog = s.historyLog || [];
    const myFixedName = localStorage.getItem("my_badminton_name") || "";
    const isTestMode = s.isTestMode === true;

    if (s.status === "예정") {
        liveContainer.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">대기중 채널입니다. 매칭 가동 시작 시 대진표가 개방됩니다.</div>`;
        return;
    }

    if(s.status === "종료") {
        if(historyLog.length === 0) { liveContainer.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">기록 없음</div>`; return; }
        liveContainer.innerHTML = [...historyLog].reverse().map((m, idx) => {
            const aNames = getNamesFromIds(m.teamA, m.teamANames).join(', '); const bNames = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
            const winA = m.scoreA > m.scoreB;
            return `
                <div class="bg-white border p-3 rounded-xl text-xs space-y-1">
                    <div class="text-[10px] font-mono text-slate-400">제 ${historyLog.length - idx}경기 완료</div>
                    <div class="grid grid-cols-2 gap-2 text-center">
                        <div class="p-1.5 rounded border ${winA ? 'border-emerald-400 bg-emerald-50/20':'border-rose-200'} font-bold flex justify-between"><span>${aNames}</span><span>${m.scoreA}</span></div>
                        <div class="p-1.5 rounded border ${!winA ? 'border-emerald-400 bg-emerald-50/20':'border-rose-200'} font-bold flex justify-between"><span>${m.scoreB}</span><span>${bNames}</span></div>
                    </div>
                </div>`;
        }).join('');
        return;
    }

    if (currentMatches.length === 0) { liveContainer.innerHTML = `<div class="text-center py-10 text-slate-400 text-xs">매칭 연산 대기 중...</div>`; return; }

    liveContainer.innerHTML = currentMatches.map((m, idx) => {
        if (m.status === "완료") return '';
        const aNames = getNamesFromIds(m.teamA, m.teamANames).join(', '); const bNames = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
        const isMyMatch = getNamesFromIds(m.teamA, m.teamANames).concat(getNamesFromIds(m.teamB, m.teamBNames)).includes(myFixedName) && myFixedName !== "";
        const isLive = m.status === "進行중" || m.status === "진행중";
        
        let cardBg = isLive ? "border-indigo-400 bg-indigo-50/20" : "border-slate-200 bg-white";
        if(isMyMatch) cardBg = "border-amber-400 bg-amber-50/50 ring-2 ring-amber-400/20 scale-[1.01]";

        const ctrlBtn = isLive 
            ? `<button data-id="${m.id}" class="btn-open-score bg-emerald-600 text-white font-bold text-[11px] px-2.5 py-1 rounded-xl cursor-pointer">🛑 경기 종료</button>` 
            : `<button data-id="${m.id}" class="btn-start-match bg-indigo-600 text-white font-bold text-[11px] px-2.5 py-1 rounded-xl cursor-pointer">▶&nbsp;경기시작</button>`;
        
        const aiBtn = (isLive && isTestMode && isAdminMode) ? `<button data-id="${m.id}" class="btn-ai-simulate bg-purple-600 text-white font-bold text-[10px] px-2 py-1 rounded-xl ml-1">🤖 AI정산</button>` : '';

        return `
            <div class="rounded-2xl p-4 border transition-all space-y-3 ${cardBg}">
                <div class="flex justify-between items-center border-b pb-1">
                    <span class="text-[10px] font-black font-sans text-indigo-600">${isLive ? '⚡ 진행중' : '⏳ 추천대진 ' + (idx + 1) + '순위'} ${isMyMatch ? '🔥 내 경기!':''}</span>
                    <div class="flex items-center">${ctrlBtn}${aiBtn}</div>
                </div>
                <div class="grid grid-cols-7 text-center items-center text-xs font-black">
                    <div class="col-span-3 truncate bg-slate-50 border p-1.5 rounded-xl">${aNames}</div>
                    <div class="col-span-1 text-slate-300 font-mono">VS</div>
                    <div class="col-span-3 truncate bg-slate-50 border p-1.5 rounded-xl">${bNames}</div>
                </div>
            </div>`;
    }).join('');

    document.querySelectorAll('.btn-start-match').forEach(btn => {
        btn.onclick = function() {
            const mId = this.getAttribute('data-id'); const target = currentMatches.find(x => x.id === mId); if(!target) return;
            const names = getNamesFromIds(target.teamA, target.teamANames).concat(getNamesFromIds(target.teamB, target.teamBNames));
            if(isAdminMode || names.includes(myFixedName)) {
                target.status = "진행중"; update(ref(db, `sessions/${window.currentSessionKey}`), { currentMatches });
            } else { alert("당사자만 기동 가능합니다!"); }
        };
    });
    document.querySelectorAll('.btn-open-score').forEach(btn => { btn.onclick = function() { openScoreModal(this.getAttribute('data-id')); }; });
    document.querySelectorAll('.btn-ai-simulate').forEach(btn => { btn.onclick = function() { handleAiSimulatedMatchCalculation(this.getAttribute('data-id')); }; });
}

function handleAiSimulatedMatchCalculation(mId) {
    const s = window.currentActiveSession; if(!s) return;
    const currentMatches = s.currentMatches || []; const match = currentMatches.find(x => x.id === mId); if(!match) return;

    let sumA = 0; let sumB = 0;
    match.teamA.forEach(id => { sumA += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
    match.teamB.forEach(id => { sumB += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });

    const maxScore = s.targetScore || 25; const randomFactor = Math.random();
    let scoreA = maxScore, scoreB = maxScore;
    if (sumA >= sumB && randomFactor > 0.15 || sumB > sumA && randomFactor <= 0.15) { scoreB = Math.max(0, maxScore - 4 - Math.floor(Math.random() * 8)); } 
    else { scoreA = Math.max(0, maxScore - 4 - Math.floor(Math.random() * 8)); }

    let historyLog = s.historyLog || []; let statsLog = s.statsLog || {};
    match.scoreA = scoreA; match.scoreB = scoreB; match.status = "완료";
    historyLog.push({ ...match, timestamp: Date.now() });
    const nextMatches = currentMatches.filter(x => x.id !== mId);

    const winTeamA = scoreA > scoreB; const expA = 1 / (1 + Math.pow(10, ((sumB/2) - (sumA/2)) / 400)); const expB = 1 / (1 + Math.pow(10, ((sumA/2) - (sumB/2)) / 400));
    const deltaA = Math.round(32 * ((winTeamA?1:0) - expA)); const deltaB = Math.round(32 * ((!winTeamA?1:0) - expB));
    
    [...match.teamA, ...match.teamB].forEach(id => { if(!statsLog[id]) statsLog[id] = { win: 0, lose: 0, delta: 0 }; });
    match.teamA.forEach(id => { if(winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaA; });
    match.teamB.forEach(id => { if(!winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaB; });

    update(ref(db, `sessions/${window.currentSessionKey}`), { currentMatches: nextMatches, historyLog, statsLog }).then(() => { recalculateLiveQueueMatch(); });
}

function recalculateLiveQueueMatch() {
    const s = window.currentActiveSession; if (!s || s.status !== "진행중" || window.allSystemPlayers.length === 0) return;
    let currentMatches = s.currentMatches || []; const attendees = s.attendees || []; const restList = s.restPlayers || []; const historyLog = s.historyLog || [];
    const maxCourts = s.courts || 2;

    let busyIds = new Set(); restList.forEach(id => busyIds.add(id));
    currentMatches.forEach(m => { if (m.status === "진행중" || m.status === "완료") { m.teamA.forEach(id => busyIds.add(id)); m.teamB.forEach(id => busyIds.add(id)); } });

    let playCounts = {}; attendees.forEach(id => playCounts[id] = 0);
    historyLog.forEach(m => { [...m.teamA, ...m.teamB].forEach(id => { if(playCounts[id] !== undefined) playCounts[id]++; }); });

    currentMatches = currentMatches.map(m => {
        if (m.status !== "대기") return m;
        let cleanA = m.teamA.filter(id => !restList.includes(id) && attendees.includes(id));
        let cleanB = m.teamB.filter(id => !restList.includes(id) && attendees.includes(id));
        if (cleanA.length < 2 || cleanB.length < 2) {
            let currentComboIds = new Set([...cleanA, ...cleanB]);
            let freeQueue = attendees.filter(id => !busyIds.has(id) && !restList.includes(id) && !currentComboIds.has(id)).sort((a, b) => (playCounts[a] || 0) - (playCounts[b] || 0));
            while (cleanA.length < 2 && freeQueue.length > 0) cleanA.push(freeQueue.shift());
            while (cleanB.length < 2 && freeQueue.length > 0) cleanB.push(freeQueue.shift());
        }
        return { ...m, teamA: cleanA, teamB: cleanB, teamANames: getNamesFromIds(cleanA), teamBNames: getNamesFromIds(cleanB) };
    });

    let finalMatches = [];
    currentMatches.forEach(m => { finalMatches.push(m); m.teamA.forEach(id => busyIds.add(id)); m.teamB.forEach(id => busyIds.add(id)); });

    const extraSlots = maxCourts - finalMatches.length;
    for (let i = 0; i < extraSlots; i++) {
        let freshQueue = attendees.filter(id => !busyIds.has(id) && !restList.includes(id)).sort((a, b) => (playCounts[a] || 0) - (playCounts[b] || 0));
        if (freshQueue.length >= 4) {
            const p1 = freshQueue.shift(); const p2 = freshQueue.shift(); const p3 = freshQueue.shift(); const p4 = freshQueue.shift();
            finalMatches.push({
                id: `m_${Date.now()}_slot_${i}`, status: "대기", teamA: [p1, p2], teamB: [p3, p4], teamANames: getNamesFromIds([p1, p2]), teamBNames: getNamesFromIds([p3, p4])
            });
            busyIds.add(p1); busyIds.add(p2); busyIds.add(p3); busyIds.add(p4);
        }
    }
    update(ref(db, `sessions/${window.currentSessionKey}`), { currentMatches: finalMatches });
}

function renderSessionRankTable(s) {
    const tbody = document.getElementById('sessionLiveRankTableBody'); if (!tbody || window.allSystemPlayers.length === 0) return;
    const attendees = s.attendees || []; const historyLog = s.historyLog || [];
    let map = {}; attendees.forEach(id => { const p = window.allSystemPlayers.find(x => x.id === id); map[id] = { name: p ? p.name : id, win: 0, lose: 0, scoreDiff: 0 }; });

    historyLog.forEach(m => {
        const scoreA = m.scoreA || 0; const scoreB = m.scoreB || 0; const teamAWon = scoreA > scoreB;
        m.teamA.forEach(id => { if (map[id]) { if (teamAWon) map[id].win++; else map[id].lose++; map[id].scoreDiff += (scoreA - scoreB); } });
        m.teamB.forEach(id => { if (map[id]) { if (!teamAWon) map[id].win++; else map[id].lose++; map[id].scoreDiff += (scoreB - scoreA); } });
    });

    let list = Object.entries(map).map(([id, val]) => ({ id: parseInt(id), ...val })).sort((a, b) => b.win - a.win || b.scoreDiff - a.scoreDiff);
    tbody.innerHTML = list.map((p, idx) => `<tr class="${idx===0&&p.win>0?'hot-player-card text-red-500 font-bold':''}"><td class="py-2 font-bold">${p.name}</td><td>${p.win}승${p.lose}패</td><td class="text-indigo-600 font-bold">${p.win+p.lose>0?Math.round(p.win/(p.win+p.lose)*100):0}%</td><td>${p.scoreDiff>0?'+'+p.scoreDiff:p.scoreDiff}</td></tr>`).join('');
}

let scoreModalTargetMatchId = null;
function openScoreModal(mId) {
    scoreModalTargetMatchId = mId; const m = window.currentActiveSession.currentMatches.find(x => x.id === mId); if (!m) return;
    document.getElementById('modalTeamANames').innerText = getNamesFromIds(m.teamA, m.teamANames).join(', ');
    document.getElementById('modalTeamBNames').innerText = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
    document.getElementById('radioWinA').checked = false; document.getElementById('radioWinB').checked = false;
    document.getElementById('inputScoreA').value = ''; document.getElementById('inputScoreB').value = '';
    document.getElementById('scoreModal').classList.remove('hidden');
}
if(document.getElementById('btnCloseScoreModal')) document.getElementById('btnCloseScoreModal').onclick = () => document.getElementById('scoreModal').classList.add('hidden');

if(document.getElementById('btnSubmitMatchScore')) {
    document.getElementById('btnSubmitMatchScore').onclick = function() {
        const sel = document.querySelector('input[name="winnerSelect"]:checked')?.value; if(!sel) { alert("승리팀 체크 필수!"); return; }
        const sA = parseInt(document.getElementById('inputScoreA').value); const sB = parseInt(document.getElementById('inputScoreB').value);
        if (isNaN(sA) || isNaN(sB) || sA === sB) { alert("점수 기입 에러!"); return; }

        const s = window.currentActiveSession; let currentMatches = s.currentMatches || []; let historyLog = s.historyLog || []; let statsLog = s.statsLog || {};
        const mIdx = currentMatches.findIndex(x => x.id === scoreModalTargetMatchId); if (mIdx === -1) return;

        let match = currentMatches[mIdx]; match.scoreA = sA; match.scoreB = sB; match.status = "완료";
        historyLog.push({ ...match, timestamp: Date.now() }); currentMatches = currentMatches.filter(x => x.id !== scoreModalTargetMatchId);

        const winTeamA = sA > sB; let sumA = 0, sumB = 0;
        match.teamA.forEach(id => { sumA += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
        match.teamB.forEach(id => { sumB += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
        const expA = 1 / (1 + Math.pow(10, ((sumB/2) - (sumA/2)) / 400)); const expB = 1 / (1 + Math.pow(10, ((sumA/2) - (sumB/2)) / 400));
        const deltaA = Math.round(32 * ((winTeamA?1:0) - expA)); const deltaB = Math.round(32 * ((!winTeamA?1:0) - expB));
        
        [...match.teamA, ...match.teamB].forEach(id => { if(!statsLog[id]) statsLog[id] = { win: 0, lose: 0, delta: 0 }; });
        match.teamA.forEach(id => { if(winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaA; });
        match.teamB.forEach(id => { if(!winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaB; });

        document.getElementById('scoreModal').classList.add('hidden');
        update(ref(db, `sessions/${window.currentSessionKey}`), { currentMatches, historyLog, statsLog }).then(() => { recalculateLiveQueueMatch(); });
    };
}

function executeLocalRecordSearch(queryName) {
    const container = document.getElementById('localSearchResultContainer'); if(!container || window.allSystemPlayers.length === 0) return;
    const query = queryName ? queryName.trim() : ""; if(!query) return;
    localStorage.setItem("my_badminton_name", query);
    const historyLog = window.currentActiveSession ? (window.currentActiveSession.historyLog || []) : [];
    const filtered = historyLog.filter(m => getNamesFromIds(m.teamA, m.teamANames).includes(query) || getNamesFromIds(m.teamB, m.teamBNames).includes(query)).reverse();
    
    container.innerHTML = filtered.map(m => {
        const winA = m.scoreA > m.scoreB;
        return `
            <div class="bg-white border rounded-xl p-2 text-[11px] space-y-1">
                <div class="grid grid-cols-2 gap-1 text-center font-bold">
                    <div class="p-1 rounded ${winA?'border border-emerald-400 bg-emerald-50/10':''}">${getNamesFromIds(m.teamA, m.teamANames).join(',')}(${m.scoreA})</div>
                    <div class="p-1 rounded ${!winA?'border border-emerald-400 bg-emerald-50/10':''}">${m.scoreB}(${getNamesFromIds(m.teamB, m.teamBNames).join(',')})</div>
                </div>
            </div>`;
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
        container.innerHTML = allMatched.reverse().map(m => `<div class="bg-slate-50 border p-2 rounded-xl flex justify-between"><div><div class="text-[9px] text-indigo-600 font-bold">${m.title}</div><div>${m.computedANames.join(',')} VS ${m.computedBNames.join(',')}</div></div><div class="font-mono font-black">${m.scoreA}:${m.scoreB}</div></div>`).join('');
    }, { onlyOnce: true });
}

// ==========================================
// 🚀 [초강력 부팅 가드] 순수 자바스크립트 즉시 판독 실행 브리지
// ==========================================
function bootAppEngine() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionUrlId = urlParams.get('id');

    if (sessionUrlId) {
        window.currentSessionKey = sessionUrlId;
        window.initSessionPage();
        console.log("🏟️ 세션 관제탑 시동 완료");
    } else if (document.getElementById('globalRankTableBody')) {
        window.initDashboardPage();
        console.log("🏠 메인 대문 시동 완료");
    }
}

// DOM 상태에 맞춰 철벽 안전 가드 상시 안전 구동 보장
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootAppEngine);
} else {
    bootAppEngine();
}
