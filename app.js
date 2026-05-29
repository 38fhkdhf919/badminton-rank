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

window.isAdminMode = localStorage.getItem("badminton_admin_login") === "true";
window.currentActiveSession = null;
window.currentSessionKey = null;
let activeChartInstance = null;
window.allSystemPlayers = [];

// 📡 파이어베이스 /players 실시간 동기화
onValue(ref(db, 'players'), (snapshot) => {
    const data = snapshot.val();
    if (data) {
        window.allSystemPlayers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
        window.allSystemPlayers.sort((a, b) => a.id - b.id);
        
        if (document.getElementById('globalRankTableBody')) {
            const sessionsRef = ref(db, 'sessions');
            onValue(sessionsRef, (snap) => { if(snap.val()) calculateGlobalLeaderboard(snap.val()); }, { onlyOnce: true });
        } else if (window.currentActiveSession) {
            renderAttendanceBox(window.currentActiveSession);
            renderSessionRankTable(window.currentActiveSession);
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
}

// ==========================================
// 🏟️ 특정 정모 세션 제어 라이브 채널
// ==========================================
window.initSessionPage = function() {
    const urlParams = new URLSearchParams(window.location.search);
    window.currentSessionKey = urlParams.get('id');
    if (!window.currentSessionKey) return;

    const btnToggle = document.getElementById('btnAdminToggle');
    if (btnToggle) {
        if (isAdminMode) {
            btnToggle.innerText = "🔓 관리자 인증 해제";
            btnToggle.className = "bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition shadow-sm cursor-pointer flex items-center gap-1";
        } else {
            btnToggle.innerText = "🔐 마스터 관리자 인증";
            btnToggle.className = "bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-700 transition shadow-sm cursor-pointer flex items-center gap-1";
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

    const sessionRef = ref(db, `sessions/${window.currentSessionKey}`);
    onValue(sessionRef, (snapshot) => {
        const s = snapshot.val();
        if (!s) return;
        window.currentActiveSession = s;

        document.getElementById('sessionMainTitle').innerText = s.title;
        document.getElementById('sessionMetaText').innerText = `📅 정모일: ${s.date || '미정'} • 🎯 목표스코어: ${s.targetScore || 25}점 제`;
        
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

        const keyboardInputWrapper = document.getElementById('adminOnlyAttendanceInputWrapper');
        if(keyboardInputWrapper) {
            if(isAdminMode && s.status !== "종료") keyboardInputWrapper.classList.remove('hidden');
            else keyboardInputWrapper.classList.add('hidden');
        }

        const beforeStatsBox = document.getElementById('beforeStartStatsBox');
        const liveStatsWrapper = document.getElementById('liveStatsActiveWrapper');
        if(s.status === "예정") {
            if(beforeStatsBox) beforeStatsBox.classList.remove('hidden');
            if(liveStatsWrapper) { liveStatsWrapper.classList.remove('flex'); liveStatsWrapper.classList.add('hidden'); }
        } else {
            if(beforeStatsBox) beforeStatsBox.classList.add('hidden');
            if(liveStatsWrapper) { liveStatsWrapper.classList.remove('hidden'); liveStatsWrapper.classList.add('flex'); }
        }

        const configBox = document.getElementById('adminConfigBox');
        if(configBox && isAdminMode) {
            configBox.classList.remove('hidden'); configBox.classList.add('flex');
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

    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            window.allSystemPlayers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
            window.allSystemPlayers.sort((a, b) => a.id - b.id);
            buildIdentityDropdown();
            if(window.currentActiveSession) {
                renderAttendanceBox(window.currentActiveSession);
                renderSessionRankTable(window.currentActiveSession);
            }
        }
    });

    setTimeout(() => {
        const radioA = document.getElementById('radioWinA'); const radioB = document.getElementById('radioWinB');
        if(radioA && radioB) {
            radioA.onchange = function() { if(this.checked && window.currentActiveSession) { document.getElementById('inputScoreA').value = window.currentActiveSession.targetScore || 25; document.getElementById('inputScoreB').value = ''; } };
            radioB.onchange = function() { if(this.checked && window.currentActiveSession) { document.getElementById('inputScoreB').value = window.currentActiveSession.targetScore || 25; document.getElementById('inputScoreA').value = ''; } };
        }
    }, 1000);
};

function buildIdentityDropdown() {
    const select = document.getElementById('selectMyIdentity');
    if (!select || select.options.length > 1) return;
    window.allSystemPlayers.forEach(p => {
        const opt = document.createElement('option'); opt.value = p.name; opt.innerText = `${p.name} (${p.tier}조)`; select.appendChild(opt);
    });
    const savedName = localStorage.getItem("my_badminton_name");
    if (savedName) select.value = savedName;
    select.onchange = function() {
        const val = this.value; localStorage.setItem("my_badminton_name", val);
        const searchInput = document.getElementById('inputLocalSearchPlayer');
        if(searchInput) { searchInput.value = val; executeLocalRecordSearch(val); }
        if(window.currentActiveSession) renderLiveCourtsGrid(window.currentActiveSession);
    };
}

if(document.getElementById('inputKeyboardAttendance')) {
    document.getElementById('inputKeyboardAttendance').onkeydown = function(e) {
        if(e.key === 'Enter') {
            e.preventDefault(); const query = this.value.trim(); if(!query) return;
            const matched = window.allSystemPlayers.filter(x => x.name === query);
            if(matched.length === 0) { alert("❌ 명단에 없는 이름입니다."); return; }
            if(matched.length > 1) {
                const box = document.getElementById('duplicateSelectionBox'); const listWrapper = document.getElementById('duplicateListWrapper');
                box.classList.remove('hidden');
                listWrapper.innerHTML = matched.map(p => `<button data-id="${p.id}" class="btn-resolve-dup text-left w-full bg-slate-50 hover:bg-indigo-50 border p-1.5 font-bold rounded-lg text-[11px] text-slate-800">${p.name} (ID:${p.id} / ${p.tier}조)</button>`).join('');
                document.querySelectorAll('.btn-resolve-dup').forEach(btn => {
                    btn.onclick = function() { commitAttendanceAction(parseInt(this.getAttribute('data-id'))); box.classList.add('hidden'); document.getElementById('inputKeyboardAttendance').value = ""; };
                });
            } else { commitAttendanceAction(matched[0].id); this.value = ""; }
        }
    };
}

function commitAttendanceAction(pId) {
    if(!isAdminMode) { alert("🔒 출석 및 명단 제어 권한은 관리자 전용입니다."); return; }
    const s = window.currentActiveSession; if(!s) return;
    let nextAttendees = s.attendees ? [...s.attendees] : []; let nextRest = s.restPlayers ? [...s.restPlayers] : [];
    if (!nextAttendees.includes(pId)) nextAttendees.push(pId);
    else { if (!nextRest.includes(pId)) nextRest.push(pId); else { nextRest = nextRest.filter(x => x !== pId); nextAttendees = nextAttendees.filter(x => x !== pId); } }
    update(ref(db, `sessions/${window.currentSessionKey}`), { attendees: nextAttendees, restPlayers: nextRest }).then(() => recalculateLiveQueueMatch());
}

function renderAttendanceBox(s) {
    const attendees = s.attendees || [];
    const restList = s.restPlayers || [];
    const container = document.getElementById('attendanceTogglerBox');
    const boxTitle = document.getElementById('attendanceBoxTitle');
    const label = document.getElementById('attendeeCountLabel');
    
    if (container && window.allSystemPlayers.length > 0) {
        if(s.status === "종료") {
            container.innerHTML = `<div class="text-[11px] text-slate-400 py-2 w-full text-center">🔐 정모 종료로 출석부가 잠겼습니다.</div>`;
        } else {
            let targetPlayersPool = [...window.allSystemPlayers];
            if (!isAdminMode) {
                targetPlayersPool = window.allSystemPlayers.filter(p => attendees.includes(p.id) && !restList.includes(p.id));
                if (boxTitle) boxTitle.innerText = "👥 오늘 정모 대기 회원";
                if (label) label.innerText = `${targetPlayersPool.length}명 코트 대기`;
            } else {
                if (boxTitle) boxTitle.innerText = "👥 클럽 전체 회원 명단 (체크용)";
                if (label) label.innerText = `${attendees.length}명 참석 중`;
            }

            if (targetPlayersPool.length === 0) {
                container.innerHTML = `<div class="text-[11px] text-slate-400 py-4 w-full text-center italic">현재 코트 대기 중인 회원이 없습니다.</div>`;
            } else {
                container.innerHTML = targetPlayersPool.map(p => {
                    const isChecked = attendees.includes(p.id); 
                    const isResting = restList.includes(p.id);
                    
                    let btnStyle = "bg-indigo-600 text-white font-black";
                    if (isAdminMode) {
                        btnStyle = isChecked ? "bg-indigo-600 text-white font-black" : "bg-slate-100 text-slate-600 border border-slate-200";
                        if(isResting) btnStyle = "bg-amber-100 text-amber-800 border-amber-300 line-through";
                    }

                    const disableAttr = isAdminMode ? "" : "disabled style='cursor: default;'";
                    return `<button data-id="${p.id}" ${disableAttr} class="btn-toggle-attend text-[10px] px-2 py-0.5 rounded-lg font-medium transition">${p.name}</button>`;
                }).join('');

                if(isAdminMode) {
                    document.querySelectorAll('.btn-toggle-attend').forEach(btn => {
                        btn.onclick = function() { commitAttendanceAction(parseInt(this.getAttribute('data-id'))); };
                    });
                }
            }
        }
    }

    const restContainer = document.getElementById('restPlayersContainer');
    if (restContainer) {
        if (restList.length === 0) restContainer.innerHTML = `<div class="text-[10px] text-slate-400 italic py-1">제외자가 없습니다.</div>`;
        else {
            restContainer.innerHTML = restList.map(id => {
                const p = window.allSystemPlayers.find(x => x.id === id); 
                const backBtn = (s.status !== "종료" && isAdminMode) ? `<span class="bg-amber-500 text-white font-sans font-black text-[9px] px-1 rounded-sm ml-1 cursor-pointer">복귀</span>` : '';
                return `<div data-id="${id}" class="btn-return-queue flex items-center bg-amber-50 border border-amber-200 text-amber-800 font-bold px-2 py-0.5 rounded-lg text-[10px]">${p ? p.name : id}${backBtn}</div>`;
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
        if(attendees.length === 0) {
            beforeListContainer.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs">출석체크된 대기 인원이 현재 없습니다.</div>`;
        } else {
            let activeAttendeesObjects = attendees.map(id => window.allSystemPlayers.find(x => x.id === id)).filter(Boolean);
            activeAttendeesObjects.sort((a, b) => b.displayMmr - a.displayMmr);

            beforeListContainer.innerHTML = activeAttendeesObjects.map((p, rankIdx) => {
                return `
                    <div class="flex justify-between items-center py-2.5 text-slate-700">
                        <span class="font-black text-slate-900"><span class="text-indigo-500 font-mono mr-1">[${rankIdx + 1}등]</span> ${p.name} <span class="text-[9px] text-slate-400 font-normal">(${p.tier}조)</span></span>
                        <span class="font-mono text-xs text-slate-900 font-black bg-slate-100 px-2 py-0.5 rounded-md">⭐ ${p.displayMmr}점</span>
                    </div>
                `;
            }).join('');
        }
    }
}

function renderLiveCourtsGrid(s) {
    const liveContainer = document.getElementById('liveCourtsContainer'); if (!liveContainer) return;
    const currentMatches = s.currentMatches || []; const historyLog = s.historyLog || [];
    const myFixedName = localStorage.getItem("my_badminton_name") || "";
    const isTestMode = s.isTestMode === true; // 🔥 AI 테스트 모드 판정 스위치 확보

    if (s.status === "예정") {
        liveContainer.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">대기중 채널입니다. 관리자가 정모 매칭 가동 시작 버튼을 누르면 추천 대진표 레이어가 개방됩니다.</div>`;
        return;
    }

    if(s.status === "종료") {
        if(historyLog.length === 0) liveContainer.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">오늘 마감된 경기 일지가 없습니다.</div>`;
        else {
            liveContainer.innerHTML = [...historyLog].reverse().map((m, idx) => {
                const aNames = getNamesFromIds(m.teamA, m.teamANames).join(', '); const bNames = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
                const winA = m.scoreA > m.scoreB;
                const borderA = winA ? "border-2 border-emerald-400 bg-emerald-50/10 shadow-sm" : "border border-rose-200 bg-rose-50/10";
                const borderB = !winA ? "border-2 border-emerald-400 bg-emerald-50/10 shadow-sm" : "border border-rose-200 bg-rose-50/10";
                return `
                    <div class="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-3xs space-y-2.5">
                        <div class="text-[10px] font-black font-mono text-slate-400">🏁 제 ${historyLog.length - idx}경기 최종 스코어</div>
                        <div class="grid grid-cols-2 gap-3 text-center text-xs">
                            <div class="p-2 rounded-xl flex justify-between items-center font-bold ${borderA}"><span>${aNames}</span> <span class="font-mono font-black">${m.scoreA}</span></div>
                            <div class="p-2 rounded-xl flex justify-between items-center font-bold ${borderB}"><span class="font-mono font-black">${m.scoreB}</span> <span>${bNames}</span></div>
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

    liveContainer.innerHTML = currentMatches.map((m, idx) => {
        if (m.status === "완료") return '';
        const aNames = getNamesFromIds(m.teamA, m.teamANames); const bNames = getNamesFromIds(m.teamB, m.teamBNames);
        const aNamesStr = aNames.join(', '); const bNamesStr = bNames.join(', ');
        
        const isAmIInTeamA = aNames.includes(myFixedName); const isAmIInTeamB = bNames.includes(myFixedName);
        const isMyMatchMatch = (myFixedName !== "") && (isAmIInTeamA || isAmIInTeamB);
        const isLive = m.status === "진행중";
        
        let mainCardBorder = isLive ? "border-2 border-indigo-500 bg-indigo-50/40 shadow-md" : "border border-slate-200 bg-white";
        if(isMyMatchMatch) { mainCardBorder = "border-2 border-amber-400 bg-amber-50/60 ring-4 ring-amber-400/10 scale-[1.01] shadow-md"; }
        
        const badge = isLive ? `<span class="bg-emerald-500 text-white text-[9px] font-black px-2 py-0.5 rounded-md animate-pulse">⚡ 진행중</span>` : `<span class="bg-indigo-50 text-indigo-700 text-[9px] font-black px-2 py-0.5 rounded-md border border-indigo-100">⏳ 추천대진 ${idx + 1}순위</span>`;
        const myMatchBadge = isMyMatchMatch ? `<span class="bg-gradient-to-r from-amber-500 to-orange-500 text-white font-black text-[9px] px-2 py-0.5 rounded-md animate-bounce shadow-xs">🔥 내 경기 확정!</span>` : '';
        const ctrlBtn = isLive 
            ? `<button data-id="${m.id}" class="btn-open-score bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] px-2.5 py-1.5 rounded-xl transition shadow-xs cursor-pointer">🛑 경기 종료</button>` 
            : `<button data-id="${m.id}" class="btn-start-match bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[11px] px-2.5 py-1.5 rounded-xl transition shadow-xs cursor-pointer">▶️ 경기시작</button>`;

        // 🎯 [요구 2 해결] AI 시뮬레이션 버튼 가로 바인딩 복원 (진행 중 상태이면서 AI 설정방일 경우 우측 정산단추 노출)
        const aiSimulateBtn = (isLive && isTestMode && isAdminMode)
            ? `<button data-id="${m.id}" class="btn-ai-simulate bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-[10px] px-2 py-1.5 rounded-xl ml-2 shadow-xs cursor-pointer">🤖 AI 즉시정산</button>`
            : '';

        return `
            <div class="rounded-2xl p-4 transition-all space-y-3.5 ${mainCardBorder}">
                <div class="flex justify-between items-center border-b border-slate-100/70 pb-1.5">
                    <div class="flex items-center gap-1.5">${badge}${myMatchBadge}</div>
                    <div class="flex items-center">${ctrlBtn}${aiSimulateBtn}</div>
                </div>
                <div class="grid grid-cols-7 text-center items-center text-xs font-black text-slate-800">
                    <div class="col-span-3 truncate text-left pl-1 bg-slate-100/60 p-2 rounded-xl border border-slate-200">${aNamesStr}</div>
                    <div class="col-span-1 font-mono font-black text-slate-300">VS</div>
                    <div class="col-span-3 truncate text-right pr-1 bg-slate-100/60 p-2 rounded-xl border border-slate-200">${bNamesStr}</div>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.btn-start-match').forEach(btn => {
        btn.onclick = function() {
            const mId = this.getAttribute('data-id'); const target = currentMatches.find(x => x.id === mId); if(!target) return;
            const matchedNames = getNamesFromIds(target.teamA, target.teamANames).concat(getNamesFromIds(target.teamB, target.teamBNames));
            const isUserParticipant = matchedNames.includes(myFixedName);

            if(isAdminMode || isUserParticipant) {
                target.status = "진행중"; update(ref(db, `sessions/${window.currentSessionKey}`), { currentMatches: currentMatches });
            } else { alert("🔒 경기를 가동할 권한이 없습니다! (본인 경기가 아니거나 관리자만 트리거 가능)"); }
        };
    });
    
    document.querySelectorAll('.btn-open-score').forEach(btn => {
        btn.onclick = function() { openScoreModal(this.getAttribute('data-id')); };
    });

    // 🤖 [요구 2 해결] AI 즉시정산 클릭 리스너 유기적 어태치먼트
    document.querySelectorAll('.btn-ai-simulate').forEach(btn => {
        btn.onclick = function() {
            const mId = this.getAttribute('data-id');
            handleAiSimulatedMatchCalculation(mId);
        };
    });
}

// 🤖 AI 시뮬레이터 자동 스코어 정산 기어 박스
function handleAiSimulatedMatchCalculation(mId) {
    const s = window.currentActiveSession;
    if(!s || !isAdminMode) return;
    const currentMatches = s.currentMatches || [];
    const match = currentMatches.find(x => x.id === mId);
    if(!match) return;

    // 실시간 MMR 기반 실력 비례 난수 점수 가중치 공식 가동
    let sumA = 0; let sumB = 0;
    match.teamA.forEach(id => { sumA += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
    match.teamB.forEach(id => { sumB += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });

    let scoreA, scoreB;
    const maxScore = s.targetScore || 25; // 개설된 방의 맥시멈 스코어
    const randomFactor = Math.random();

    if ((sumA >= sumB && randomFactor > 0.15) || (sumB > sumA && randomFactor <= 0.15)) {
        scoreA = maxScore;
        scoreB = Math.max(0, maxScore - 4 - Math.floor(Math.random() * 8));
    } else {
        scoreB = maxScore;
        scoreA = Math.max(0, maxScore - 4 - Math.floor(Math.random() * 8));
    }

    // 파이어베이스 트랜잭션 주입용 변수 가로채기
    let historyLog = s.historyLog || []; let statsLog = s.statsLog || {};
    match.scoreA = scoreA; match.scoreB = scoreB; match.status = "완료";

    historyLog.push({ ...match, timestamp: Date.now() });
    const nextMatches = currentMatches.filter(x => x.id !== mId);

    const winTeamA = scoreA > scoreB;
    const rA = winTeamA ? 1 : 0; const rB = winTeamA ? 0 : 1;
    const expA = 1 / (1 + Math.pow(10, ((sumB/2) - (sumA/2)) / 400));
    const expB = 1 / (1 + Math.pow(10, ((sumA/2) - (sumB/2)) / 400));
    const deltaA = Math.round(32 * (rA - expA)); const deltaB = Math.round(32 * (rB - expB));
    
    [...match.teamA, ...match.teamB].forEach(id => { if(!statsLog[id]) statsLog[id] = { win: 0, lose: 0, delta: 0 }; });
    match.teamA.forEach(id => { if(winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaA; });
    match.teamB.forEach(id => { if(!winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaB; });

    update(ref(db, `sessions/${window.currentSessionKey}`), { currentMatches: nextMatches, historyLog, statsLog }).then(() => {
        recalculateLiveQueueMatch();
    });
}

// ==========================================
// 🛠️ [요구 1 해결] 대기열 중복 분신술 버그 철통 차단 재매칭 알고리즘
// ==========================================
function recalculateLiveQueueMatch() {
    const s = window.currentActiveSession; if (!s || s.status !== "진행중" || window.allSystemPlayers.length === 0) return;

    let currentMatches = s.currentMatches || [];
    const attendees = s.attendees || [];
    const restList = s.restPlayers || [];
    const historyLog = s.historyLog || [];
    const maxCourts = s.courts || 2;

    // 🚨 [동결 창고] 제외 유저(쉼터 유저) 원천 락 격리
    let busyIds = new Set();
    restList.forEach(id => busyIds.add(id));

    // 진행중이거나 이미 완료 정산된 카드의 유저들은 대기열 연산 대상에서 우선 고정 격리
    currentMatches.forEach(m => {
        if (m.status === "진행중" || m.status === "완료") {
            m.teamA.forEach(id => busyIds.add(id)); m.teamB.forEach(id => busyIds.add(id));
        }
    });

    let playCounts = {};
    attendees.forEach(id => playCounts[id] = 0);
    historyLog.forEach(m => { [...m.teamA, ...m.teamB].forEach(id => { if(playCounts[id] !== undefined) playCounts[id]++; }); });

    // 1단계: 기존 추천 대진 카드 필터링 보정 (여기서도 쉼터 낙오자 핀포인트 교체)
    currentMatches = currentMatches.map(m => {
        if (m.status !== "대기") return m;

        const filterValidIds = (teamIds) => {
            let nextTeam = [];
            teamIds.forEach(id => { if (!restList.includes(id) && attendees.includes(id)) { nextTeam.push(id); } });
            return nextTeam;
        };

        let cleanA = filterValidIds(m.teamA); let cleanB = filterValidIds(m.teamB);
        if (cleanA.length < 2 || cleanB.length < 2) {
            let currentComboIds = new Set([...cleanA, ...cleanB]);
            // 🚨 [핵심 가드]: 이미 다른 코트에 배정받아 바쁜 사람(busyIds) 역시 실시간 필터 스캔으로 우회 배제!
            let freeQueue = attendees.filter(id => !busyIds.has(id) && !restList.includes(id) && !currentComboIds.has(id))
                                      .sort((a, b) => (playCounts[a] || 0) - (playCounts[b] || 0));
            while (cleanA.length < 2 && freeQueue.length > 0) { cleanA.push(freeQueue.shift()); }
            while (cleanB.length < 2 && freeQueue.length > 0) { cleanB.push(freeQueue.shift()); }
        }
        return { ...m, teamA: cleanA, teamB: cleanB, teamANames: getNamesFromIds(cleanA), teamBNames: getNamesFromIds(cleanB) };
    });

    // 2단계: 신규 추천 대진 큐 형성 루프 (🔥 버그 저격: 루프가 돌 때마다 새로 배정된 유저를 즉시 busyIds에 넣는 기믹)
    let finalMatches = [];
    
    // 진행중이거나 방금 보정 완료된 상위 매치 카드를 먼저 안착
    currentMatches.forEach(m => {
        finalMatches.push(m);
        // 🚨 [분신술 가드 핵심]: 대기 상태든 진행 상태든 카드가 정해지면 그 안의 선수 4명은 즉시 바쁜 사람(busyIds)으로 등 등재!!
        m.teamA.forEach(id => busyIds.add(id));
        m.teamB.forEach(id => busyIds.add(id));
    });

    const extraSlots = maxCourts - finalMatches.length;
    for (let i = 0; i < extraSlots; i++) {
        // 루프 매 회차마다 busyIds에 업데이트된 최신 현황을 기반으로 순수 대기열 풀을 매번 새로 필터링!!
        let freshQueue = attendees.filter(id => !busyIds.has(id) && !restList.includes(id))
                                  .sort((a, b) => (playCounts[a] || 0) - (playCounts[b] || 0));

        if (freshQueue.length >= 4) {
            const p1 = freshQueue.shift(); const p2 = freshQueue.shift(); const p3 = freshQueue.shift(); const p4 = freshQueue.shift();
            
            const newMatchObj = {
                id: `m_${Date.now()}_slot_${i}_r`, status: "대기",
                teamA: [p1, p2], teamB: [p3, p4],
                teamANames: getNamesFromIds([p1, p2]), teamBNames: getNamesFromIds([p3, p4])
            };
            
            finalMatches.push(newMatchObj);
            // 🚨 [연쇄 락 기어]: 방금 추가된 4명도 그 즉시 busyIds에 등록하여 다음 순위 루프에서 절대로 뽑히지 않도록 영구 격리!!
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

    let list = Object.entries(map).map(([id, val]) => ({ id: parseInt(id), ...val }));
    list.sort((a, b) => b.win - a.win || (b.win/(b.win+b.lose || 1)) - (a.win/(a.win+a.lose || 1)) || b.scoreDiff - a.scoreDiff);
    if (list.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="py-4 text-slate-400">참가자가 없습니다.</td></tr>`; return; }
    tbody.innerHTML = list.map((p, idx) => {
        const total = p.win + p.lose; const rate = total > 0 ? Math.round((p.win / total) * 100) : 0; const isHot = idx === 0 && p.win > 0;
        return `<tr class="${isHot ? 'hot-player-card text-red-600 font-black' : 'hover:bg-slate-50'}"><td class="py-2 px-1 font-bold">${p.name}${isHot ? ' 🔥' : ''}</td><td class="py-2 px-1 font-mono">${p.win}승 ${p.lose}패</td><td class="py-2 px-1 font-mono text-indigo-600 font-black">${rate}%</td><td class="py-2 px-1 font-mono font-bold">${p.scoreDiff > 0 ? '+' + p.scoreDiff : p.scoreDiff}</td></tr>`;
    }).join('');
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

if(document.getElementById('btnSubmitMatchScore')) {
    document.getElementById('btnSubmitMatchScore').onclick = function() {
        const selectedWinner = document.querySelector('input[name="winnerSelect"]:checked')?.value;
        if(!selectedWinner) { alert("🥇 승리 팀 라디오 버튼을 마킹해 주세요!"); return; }

        const sA = parseInt(document.getElementById('inputScoreA').value); const sB = parseInt(document.getElementById('inputScoreB').value);
        if (isNaN(sA) || isNaN(sB)) { alert("점수를 기입하세요!"); return; }
        if (sA === sB) { alert("무승부 불가!"); return; }
        if(selectedWinner === 'A' && sA < sB) { alert("A팀 스코어 모순!"); return; }
        if(selectedWinner === 'B' && sB < sA) { alert("B팀 스코어 모순!"); return; }

        const s = window.currentActiveSession; let currentMatches = s.currentMatches || []; let historyLog = s.historyLog || []; let statsLog = s.statsLog || {};
        const mIdx = currentMatches.findIndex(x => x.id === scoreModalTargetMatchId); if (mIdx === -1) return;

        let match = currentMatches[mIdx]; match.scoreA = sA; match.scoreB = sB; match.status = "완료";
        historyLog.push({ ...match, timestamp: Date.now() }); currentMatches = currentMatches.filter(x => x.id !== scoreModalTargetMatchId);

        const winTeamA = sA > sB; const rA = winTeamA ? 1 : 0; const rB = winTeamA ? 0 : 1;
        let sumA = 0; let sumB = 0;
        match.teamA.forEach(id => { sumA += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
        match.teamB.forEach(id => { sumB += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
        const expA = 1 / (1 + Math.pow(10, ((sumB/2) - (sumA/2)) / 400)); const expB = 1 / (1 + Math.pow(10, ((sumA/2) - (sumB/2)) / 400));
        const deltaA = Math.round(32 * (rA - expA)); const deltaB = Math.round(32 * (rB - expB));
        
        [...match.teamA, ...match.teamB].forEach(id => { if(!statsLog[id]) statsLog[id] = { win: 0, lose: 0, delta: 0 }; });
        match.teamA.forEach(id => { if(winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaA; });
        match.teamB.forEach(id => { if(!winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaB; });

        document.getElementById('scoreModal').classList.add('hidden');
        update(ref(db, `sessions/${window.currentSessionKey}`), { currentMatches, historyLog, statsLog }).then(() => { recalculateLiveQueueMatch(); });
    };
}

function executeLocalRecordSearch(queryName) {
    const container = document.getElementById('localSearchResultContainer'); if(!container || window.allSystemPlayers.length === 0) return;
    const query = queryName ? queryName.trim() : ""; if(!query) { container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">이름 검색 대기 중</div>`; return; }

    localStorage.setItem("my_badminton_name", query);
    const historyLog = window.currentActiveSession ? (window.currentActiveSession.historyLog || []) : [];
    const filtered = historyLog.filter(m => getNamesFromIds(m.teamA, m.teamANames).includes(query) || getNamesFromIds(m.teamB, m.teamBNames).includes(query)).reverse();
    if(filtered.length === 0) { container.innerHTML = `<div class="text-center py-4 text-slate-400 text-[11px]">기록이 없습니다.</div>`; return; }
    
    container.innerHTML = filtered.map(m => {
        const aNames = getNamesFromIds(m.teamA, m.teamANames); const bNames = getNamesFromIds(m.teamB, m.teamBNames);
        const isMyTeamA = aNames.includes(query); const winA = m.scoreA > m.scoreB; const isAmIWinner = (isMyTeamA && winA) || (!isMyTeamA && !winA);
        const borderA = winA ? "border border-emerald-300 bg-emerald-50/50" : "border border-rose-200 bg-rose-50/50";
        const borderB = !winA ? "border border-emerald-300 bg-emerald-50/50" : "border border-rose-200 bg-rose-50/50";
        return `
            <div class="bg-white border rounded-xl p-2.5 space-y-2 text-[11px] shadow-3xs">
                <div class="flex justify-between items-center font-mono text-[10px] text-slate-400"><span>⏱️ 정산 완료 매치</span><span class="font-black ${isAmIWinner ? 'text-emerald-600':'text-rose-500'}">${isAmIWinner ? 'WIN 🏆':'LOSE'}</span></div>
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
if (document.getElementById('selectMyIdentity')) { window.initSessionPage(); }
