import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, remove, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

window.currentSortMode = "MMR_DESC";
window.isAdminMode = localStorage.getItem("badminton_admin_login") === "true";
window.currentActiveSession = null;
window.currentSessionKey = null;
let activeChartInstance = null;
window.allSystemPlayers = [];

// 📡 파이어베이스 /players 원격 데이터베이스 캐시 수신체 결합 (0번 인덱스 가드 패치)
onValue(ref(db, 'players'), (snapshot) => {
    const data = snapshot.val();
    if (data) {
        window.allSystemPlayers = Object.values(data).filter(p => p && p.id);
        window.allSystemPlayers.sort((a, b) => a.id - b.id);
        
        console.log("📡 회원 명단 로드 완료:", window.allSystemPlayers.length, "명");
        
        if (document.getElementById('globalRankTableBody') && window.currentSessionKey === null) {
            const sessionsRef = ref(db, 'sessions');
            onValue(sessionsRef, (snap) => { if(snap.val()) calculateGlobalLeaderboard(snap.val()); }, { onlyOnce: true });
        } else if (window.currentSessionKey) {
            buildIdentityDropdown();
            if(window.currentActiveSession) {
                renderAttendanceBox(window.currentActiveSession);
                renderLiveCourtsGrid(window.currentActiveSession);
                renderSessionRankTable(window.currentActiveSession);
            }
        }
    }
}, (error) => {
    console.error("파이어베이스 로드 에러:", error);
});

function getNamesFromIds(ids, fallbackNames) {
    if (fallbackNames && fallbackNames.length > 0) return fallbackNames.filter(Boolean);
    if (!ids || ids.length === 0) return ["상대 팀 탐색 중..."]; 
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
    const wrapper = document.getElementById('adminButtonWrapper');
    
    if (btnToggle && wrapper) {
        if (window.isAdminMode) {
            btnToggle.innerText = "🔓 관리자 모드 인증 해제";
            btnToggle.className = "bg-indigo-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition shadow-sm cursor-pointer flex items-center gap-1.5";
            wrapper.style.height = "38px";
            wrapper.style.marginTop = "0.5rem";
        } else {
            btnToggle.innerText = "🔐 마스터 관리자 인증";
            btnToggle.className = "bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl border border-slate-700 transition shadow-sm cursor-pointer flex items-center gap-1.5";
            wrapper.style.height = "0px";
            wrapper.style.marginTop = "0px";
        }

        let clickCount = 0;
        let lastClickTime = 0;
        const triggerNode = document.getElementById('easterEggTrigger');

        if (triggerNode) {
            triggerNode.onclick = function() {
                const currentTime = Date.now();
                if (currentTime - lastClickTime > 2500) { clickCount = 0; }
                
                clickCount++;
                lastClickTime = currentTime;

                if (clickCount === 5) {
                    wrapper.style.height = "38px"; 
                    wrapper.style.marginTop = "0.5rem";
                    btnToggle.classList.add('fire-rank-card');
                    clickCount = 0;
                }
            };
        }

        btnToggle.onclick = function() {
            if (!window.isAdminMode) {
                if (prompt("🔐 관리자 마스터 비밀번호를 입력하세요:") === "1234") {
                    window.isAdminMode = true;
                    localStorage.setItem("badminton_admin_login", "true");
                } else { alert("❌ 비밀번호 불일치!"); return; }
            } else {
                window.isAdminMode = false;
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
        const testWrapper = document.getElementById('testModeWrapper');
        
        if (testWrapper) testWrapper.style.display = window.isAdminMode ? 'flex' : 'none';
        if (!container) return;
        
        if (!data) {
            container.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">개설된 정모 세션이 전혀 없습니다.</div>`;
            if (badgeCount) badgeCount.innerText = "0개 방";
            const tbody = document.getElementById('globalRankTableBody');
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400">정모 데이터가 없어 누적 레이팅 통계가 비어있습니다.</td></tr>`;
            return;
        }

        const sessionEntries = Object.entries(data).reverse();
        if (badgeCount) badgeCount.innerText = `${sessionEntries.length}개 방`;

        calculateGlobalLeaderboard(data);

        container.innerHTML = sessionEntries.map(([id, s]) => {
            let badgeStyle = "bg-amber-50 text-amber-700 border-amber-200";
            if (s.status === "진행중") badgeStyle = "bg-emerald-50 text-emerald-700 border-emerald-200 animate-pulse";
            if (s.status === "종료") badgeStyle = "bg-indigo-50 text-indigo-700 border-indigo-200";
            
            const delBtn = window.isAdminMode ? `<button data-id="${id}" class="btn-delete-session bg-rose-50 text-rose-600 border border-rose-200 font-bold text-[10px] px-2 py-0.5 rounded-lg cursor-pointer ml-2">🗑️</button>` : '';
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
                </div>`;
        }).join('');

        document.querySelectorAll('.btn-delete-session').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault(); const sid = this.getAttribute('data-id');
                if (confirm(`해당 정모방을 삭제하시겠습니까?`)) { remove(ref(db, `sessions/${sid}`)).then(() => window.location.reload()); }
            };
        });
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
            }).then(() => { alert("🚀 정모 리그 테이블 형성 완료!"); window.location.reload(); });
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
        if (p && p.id) {
            aggregateMap[p.id] = { id: p.id, name: p.name, tier: p.tier, baseMmr: p.displayMmr || 1000, win: 0, lose: 0, deltaSum: 0, historyTimeline: [] };
        }
    });

    const sortedSessions = Object.entries(allSessions || {})
        .filter(([_, s]) => s && s.createdAt)
        .sort((a,b) => a[1].createdAt - b[1].createdAt);

    sortedSessions.forEach(([sKey, s]) => {
        if (s && s.statsLog && Object.keys(s.statsLog).length > 0) {
            Object.entries(s.statsLog).forEach(([pId, log]) => {
                const player = aggregateMap[pId];
                if (player && log) {
                    player.win += (log.win || 0); 
                    player.lose += (log.lose || 0); 
                    player.deltaSum += (log.delta || 0);
                    player.historyTimeline.push(player.baseMmr + player.deltaSum);
                }
            });
        }
    });

    let sortedList = Object.values(aggregateMap).sort((a, b) => (b.baseMmr + b.deltaSum) - (a.baseMmr + a.deltaSum));
    
    if (sortedList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400">조회 가능한 통합 레이팅 데이터가 없습니다.</td></tr>`;
        return;
    }

    tbody.innerHTML = sortedList.map((p, idx) => {
        const total = p.win + p.lose;
        return `
            <tr class="hover:bg-indigo-50/40 transition-colors cursor-pointer btn-open-trend-chart" data-id="${p.id}" data-name="${p.name}" data-timeline="${JSON.stringify(p.historyTimeline)}">
                <td class="py-2.5 px-4 text-center font-black text-slate-400 font-mono">${idx + 1}</td>
                <td class="py-2.5 px-4 font-black text-indigo-950">${p.name} <span class="text-[10px] text-slate-400 font-normal">(${p.tier}조)</span></td>
                <td class="py-2.5 px-4 text-center font-mono text-slate-500">${total}판</td>
                <td class="py-2.5 px-4 text-center font-mono text-slate-600">${p.win}승 / ${p.lose}패</td>
                <td class="py-2.5 px-4 text-center font-mono font-black text-indigo-600">${total>0?Math.round(p.win/total*100):0}%</td>
                <td class="py-2.5 px-4 text-right font-black font-mono text-slate-900">${p.baseMmr + p.deltaSum}점</td>
            </tr>`;
    }).join('');

    document.querySelectorAll('.btn-open-trend-chart').forEach(tr => {
        tr.onclick = function() {
            const pId = this.getAttribute('data-id'); const pName = this.getAttribute('data-name');
            const timelineStr = this.getAttribute('data-timeline');
            if (!timelineStr) return;
            
            const timeline = JSON.parse(timelineStr);
            document.getElementById('modalPlayerTitle').innerText = `🏆 [${pName}] 회원 MMR 성장 곡선`;
            document.getElementById('chartModal').classList.remove('hidden');
            const chartData = timeline.length > 0 ? timeline.slice(-7) : [aggregateMap[pId]?.baseMmr || 1000];
            const ctx = document.getElementById('playerTrendChart').getContext('2d');
            if (activeChartInstance) activeChartInstance.destroy();
            
            activeChartInstance = new Chart(ctx, {
                type: 'line', 
                data: { 
                    labels: chartData.map((_, i) => `${i + 1}회차`), 
                    datasets: [{ 
                        label: '실시간 레이팅 (MMR)', 
                        data: chartData, 
                        borderColor: '#4f46e5', 
                        borderWidth: 3, 
                        fill: false 
                    }] 
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        };
    });

    const btnCloseModal = document.getElementById('btnCloseModal');
    if (btnCloseModal) {
        btnCloseModal.onclick = function() {
            document.getElementById('chartModal').classList.add('hidden');
        };
    }
}

// ==========================================
// 🏟️ 특정 정모 세션 제어 라이브 채널 코어
// ==========================================
window.initSessionPage = function() {
    const btnToggle = document.getElementById('btnAdminToggle');
    const wrapper = document.getElementById('adminButtonWrapper');
    
    if (btnToggle && wrapper) {
        if (window.isAdminMode) {
            btnToggle.innerText = "🔓 관리자 인증 해제";
            btnToggle.className = "bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition shadow-sm cursor-pointer flex items-center gap-1";
            wrapper.style.height = "34px";
            wrapper.style.marginTop = "0.25rem";
        } else {
            btnToggle.innerText = "🔐 마스터 관리자 인증";
            btnToggle.className = "bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-700 transition shadow-sm cursor-pointer flex items-center gap-1";
            wrapper.style.height = "0px";
            wrapper.style.marginTop = "0px";
        }

        let clickCount = 0; 
        let lastTime = 0;
        
        const bindTriggerLoop = setInterval(() => {
            const triggerNode = document.getElementById('sessionMainTitle');
            if (triggerNode) {
                clearInterval(bindTriggerLoop);
                triggerNode.onclick = function() {
                    const now = Date.now(); 
                    if (now - lastTime > 2500) { clickCount = 0; }
                    clickCount++; 
                    lastTime = now;
                    
                    if (clickCount === 5) {
                        wrapper.style.height = "34px";
                        wrapper.style.marginTop = "0.25rem";
                        btnToggle.className = "bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-1.5 rounded-xl border transition shadow-sm cursor-pointer flex items-center gap-1 fire-rank-card";
                        clickCount = 0;
                    }
                };
            }
        }, 100);

        btnToggle.onclick = function() {
            if (!window.isAdminMode) {
                if (prompt("🔐 마스터 암호를 기입하세요:") === "1234") { 
                    window.isAdminMode = true; 
                    localStorage.setItem("badminton_admin_login", "true"); 
                } else { alert("비밀번호 에러!"); return; }
            } else { 
                window.isAdminMode = false; 
                localStorage.setItem("badminton_admin_login", "false"); 
            }
            window.location.reload();
        };
    }

    // 🎯 [01 패치 적용]: 세션 최초 리스너 로드 단계 분기점 확보
    const initialSessionPath = localStorage.getItem("badminton_admin_login") === "true" && window.location.href.includes("testMode=true")
        ? `test_sessions/${window.currentSessionKey}`
        : `sessions/${window.currentSessionKey}`;

    // 실제로는 안전하게 파이어베이스가 세션 객체를 밀어줄 때 동적 감지합니다.
    const rootSessionRef = ref(db, `sessions/${window.currentSessionKey}`);
    onValue(rootSessionRef, (snapshot) => {
        let s = snapshot.val();
        
        // 만약 정식 노드에 없다면 테스트 노드 스캔 시도
        if (!s) {
            get(ref(db, `test_sessions/${window.currentSessionKey}`)).then((testSnap) => {
                if(testSnap.exists()) {
                    s = testSnap.val();
                    window.currentActiveSession = s;
                    proceedSessionRender(s);
                }
            });
        } else {
            window.currentActiveSession = s;
            proceedSessionRender(s);
        }
    });

    function proceedSessionRender(s) {
        const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
        const sessionRef = ref(db, targetPath);

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
        if (window.isAdminMode && adminPanel && btnToggleStatus) {
            adminPanel.classList.remove('hidden'); adminPanel.classList.add('flex');
            btnToggleStatus.innerText = s.status === "예정" ? "▶️ 정모 매칭 가동 시작" : (s.status === "진행중" ? "🛑 오늘 정모 최종 마감/종료" : "🔒 정모 폐쇄됨");
            btnToggleStatus.disabled = s.status === "종료";
            
            btnToggleStatus.onclick = function() {
                if (s.status === "예정") { update(sessionRef, { status: "진행중" }).then(() => recalculateLiveQueueMatch()); } 
                else if (s.status === "진행중") { if (confirm("오늘 정모를 최종 마감 전송하시겠습니까?")) { update(sessionRef, { status: "종료" }); } }
            };
        }

        const keyboardInputWrapper = document.getElementById('adminOnlyAttendanceInputWrapper');
        if(keyboardInputWrapper) keyboardInputWrapper.style.display = (window.isAdminMode && s.status !== "종료") ? 'block' : 'none';

        const beforeStatsBox = document.getElementById('beforeStartStatsBox');
        const liveStatsWrapper = document.getElementById('liveStatsActiveWrapper');
        if(s.status === "예정") {
            if(beforeStatsBox) beforeStatsBox.style.display = 'block';
            if(liveStatsWrapper) { liveStatsWrapper.style.display = 'none'; }
        } else {
            if(beforeStatsBox) beforeStatsBox.style.display = 'none';
            if(liveStatsWrapper) { liveStatsWrapper.style.display = 'flex'; liveStatsWrapper.classList.remove('hidden'); }
        }

        const configBox = document.getElementById('adminConfigBox');
        if(configBox && window.isAdminMode) {
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
        
        setTimeout(() => {
            const targetHeader = document.querySelector('#sessionLiveRankTableBody')?.parentElement?.querySelector('thead');
            if (targetHeader && !targetHeader.hasAttribute('data-sort-bound')) {
                targetHeader.setAttribute('data-sort-bound', 'true');
                targetHeader.style.cursor = 'pointer';
                targetHeader.title = '클릭 시 [MMR 정렬 ↔ 등락 점수 정렬] 스위칭';
                
                targetHeader.onclick = function() {
                    if (window.currentSortMode === "MMR_DESC") window.currentSortMode = "MMR_ASC";
                    else if (window.currentSortMode === "MMR_ASC") window.currentSortMode = "DELTA_DESC";
                    else if (window.currentSortMode === "DELTA_DESC") window.currentSortMode = "DELTA_ASC";
                    else window.currentSortMode = "MMR_DESC";
                    
                    renderSessionRankTable(window.currentActiveSession);
                };
            }
        }, 500);
        
        const searchInput = document.getElementById('inputLocalSearchPlayer');
        if(searchInput) {
            if(!searchInput.value) searchInput.value = localStorage.getItem("my_badminton_name") || "";
            executeLocalRecordSearch(searchInput.value);
            searchInput.oninput = function() { executeLocalRecordSearch(this.value); };
        }
    }

    setTimeout(() => {
        const btnWinA = document.getElementById('btnWinASelector');
        const btnWinB = document.getElementById('btnWinBSelector');
        
        if (btnWinA && btnWinB) {
            btnWinA.onclick = function(e) {
                e.preventDefault();
                const maxScore = window.currentActiveSession?.targetScore || 25;
                document.getElementById('inputScoreA').value = maxScore;
                document.getElementById('inputScoreB').value = "";
                btnWinA.className = "bg-indigo-600 text-white font-black px-2.5 py-1.5 rounded-lg border border-indigo-600 transition-all";
                btnWinB.className = "bg-slate-100 text-slate-700 font-black px-2.5 py-1.5 rounded-lg border border-slate-300 transition-all";
                btnWinA.setAttribute('data-winner', 'true');
                btnWinB.removeAttribute('data-winner');
            };
            
            btnWinB.onclick = function(e) {
                e.preventDefault();
                const maxScore = window.currentActiveSession?.targetScore || 25;
                document.getElementById('inputScoreB').value = maxScore;
                document.getElementById('inputScoreA').value = "";
                btnWinB.className = "bg-emerald-600 text-white font-black px-2.5 py-1.5 rounded-lg border border-emerald-600 transition-all";
                btnWinA.className = "bg-slate-100 text-slate-700 font-black px-2.5 py-1.5 rounded-lg border border-slate-300 transition-all";
                btnWinB.setAttribute('data-winner', 'true');
                btnWinA.removeAttribute('data-winner');
            };
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
        if(window.currentActiveSession) {
            renderLiveCourtsGrid(window.currentActiveSession);
            renderAttendanceBox(window.currentActiveSession);
        }
    };
}

if(document.getElementById('inputKeyboardAttendance')) {
    document.getElementById('inputKeyboardAttendance').onkeydown = function(e) {
        if(e.key === 'Enter') {
            e.preventDefault(); const query = this.value.trim(); if(!query) return;
            const matched = window.allSystemPlayers.filter(x => x.name === query);
            if(matched.length === 0) { alert("❌ 등록되지 않은 이름 명단 오류"); return; }
            
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
    if(!isAdminMode) return;
    const s = window.currentActiveSession; if(!s) return;
    let nextAttendees = s.attendees ? [...s.attendees] : []; let nextRest = s.restPlayers ? [...s.restPlayers] : [];
    if (!nextAttendees.includes(pId)) nextAttendees.push(pId);
    else { if (!nextRest.includes(pId)) nextRest.push(pId); else { nextRest = nextRest.filter(x => x !== pId); nextAttendees = nextAttendees.filter(x => x !== pId); } }
    
    // 🎯 [01 패치 분기]: 키보드 출석 인풋 작동 구역 경로 격리
    const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
    update(ref(db, targetPath), { attendees: nextAttendees, restPlayers: nextRest }).then(() => recalculateLiveQueueMatch());
}

// ==========================================
// 👥 [레이아웃 고정] 이름 고정형 원터치 참석/쉼터 토글 인터페이스 (예정 단계 클릭 버그 완전 해결)
// ==========================================
function renderAttendanceBox(s) {
    const togglerBox = document.getElementById('attendanceTogglerBox'); if (!togglerBox) return;
    const restContainer = document.getElementById('restPlayersContainer'); if (!restContainer) return;
    
    const attendees = s.attendees ? s.attendees.map(id => parseInt(id)) : []; 
    const restList = s.restPlayers ? s.restPlayers.map(id => parseInt(id)) : [];
    const myFixedName = localStorage.getItem("my_badminton_name") || "";

    // 1. 현재 대기열 제외(쉼터) 유저를 뺀 순수 코트 대기조 필터링
    const activeQueuePlayers = attendees.filter(id => !restList.includes(id));

    // 2. 상단 카운터 정보 직관적으로 인원수만 실시간 동기화
    document.getElementById('attendeeCountLabel').innerText = `${attendees.length}명 참여 (대기 ${activeQueuePlayers.length} / 쉼터 ${restList.length})`;

    // 시스템 풀 검사 가드
    if (window.allSystemPlayers.length === 0) {
        togglerBox.innerHTML = `<div class="text-center py-4 text-slate-400 text-[11px] w-full">회원 명단을 로드 중입니다...</div>`;
        return;
    }

    // 🎯 [정모 예정 단계]: 이름만 딱 있고 선택 효과로만 제어하는 고정 크기 그리드
    if (s.status === "예정") {
        const sortedAllPlayers = [...window.allSystemPlayers].sort((a, b) => a.name.localeCompare(b.name));
        
        togglerBox.innerHTML = sortedAllPlayers.map(p => {
            const isAttending = attendees.includes(p.id);
            const isResting = restList.includes(p.id);
            
            let btnStyle = "border-slate-200 bg-white text-slate-400 hover:bg-slate-50"; // 기본 불참
            
            if (isAttending && !isResting) {
                // 참석 (인디고 네온 하이라이트 효과)
                btnStyle = "border-indigo-600 bg-indigo-50 text-indigo-900 font-black shadow-2xs ring-2 ring-indigo-500/20";
            } else if (isResting) {
                // 쉼터 (로즈 톤 다운 하이라이트 효과)
                btnStyle = "border-rose-400 bg-rose-50 text-rose-700 font-bold";
            }

            return `
                <button data-id="${p.id}" data-name="${p.name}" class="btn-toggle-active border h-[38px] px-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center cursor-pointer ${btnStyle}">
                    <span>${p.name}</span>
                </button>
            `;
        }).join('');
        
        restContainer.innerHTML = `<div class="text-slate-400 text-[10px] py-1 italic">정모 시작 전에는 위 통합 명단에서 [불참 ↔ 참석 ↔ 쉼터] 순서로 순환 토글됩니다.</div>`;
        
    } else {
        // 🔥 [정모 진행 중 단계]: 가동부 라이브 큐 레이아웃 디스플레이
        if (activeQueuePlayers.length === 0) {
            togglerBox.innerHTML = `<div class="text-center py-4 text-slate-400 text-[11px] w-full">현재 코트 대기 중인 회원이 없습니다.</div>`;
        } else {
            togglerBox.innerHTML = activeQueuePlayers.map(id => {
                const p = window.allSystemPlayers.find(x => x.id === id); if (!p) return '';
                const isMe = p.name === myFixedName && myFixedName !== "";
                const borderStyle = isMe 
                    ? "border-amber-400 bg-amber-50/50 text-amber-900 font-black ring-2 ring-amber-400/30 shadow-2xs" 
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";

                return `
                    <button data-id="${id}" data-name="${p.name}" class="btn-toggle-active border h-[38px] px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center cursor-pointer ${borderStyle}">
                        <span>${p.name}</span>
                    </button>
                `;
            }).join('');
        }

        // 대기열 제외 인원(쉼터) 실시간 뷰어 마크업 드로잉
        if (restList.length === 0) {
            restContainer.innerHTML = `<div class="text-slate-400 text-[10px] py-1 italic">현재 쉼터가 비어 있습니다.</div>`;
        } else {
            restContainer.innerHTML = restList.map(id => {
                const p = window.allSystemPlayers.find(x => x.id === id); if (!p) return '';
                const isMe = p.name === myFixedName && myFixedName !== "";
                const borderStyle = isMe 
                    ? "border-amber-400 bg-amber-50/60 text-amber-900 font-black ring-2 ring-amber-400/40" 
                    : "border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50";

                return `
                    <button data-id="${id}" data-name="${p.name}" class="btn-toggle-rest border h-[38px] px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center cursor-pointer ${borderStyle}">
                        <span>💤 ${p.name}</span>
                    </button>
                `;
            }).join('');
        }
    }

    // ==========================================================================
    // 🎯 [완벽 통합]: '예정'과 '진행중' 상관없이 클릭 시 무조건 바인딩되는 토글 핸들러 구역
    // ==========================================================================
    document.querySelectorAll('.btn-toggle-active').forEach(btn => {
        btn.onclick = function() {
            const pId = parseInt(this.getAttribute('data-id'));
            const pName = this.getAttribute('data-name');
            const isMe = pName === myFixedName && myFixedName !== "";

            if (window.isAdminMode || isMe) {
                let nextAttendees = [...attendees];
                let nextRest = [...restList];
                let currentMatches = s.currentMatches || [];

                // 🎯 1. [예정 상태] 클릭 시: 불참 ↔ 참석 ↔ 쉼터 순환 엔진 가동 및 경로 보정
                if (s.status === "예정") {
                    if (!nextAttendees.includes(pId) && !nextRest.includes(pId)) {
                        nextAttendees.push(pId);
                    } else if (nextAttendees.includes(pId) && !nextRest.includes(pId)) {
                        nextRest.push(pId);
                    } else {
                        nextAttendees = nextAttendees.filter(x => x !== pId);
                        nextRest = nextRest.filter(x => x !== pId);
                    }
                    
                    const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
                    update(ref(db, targetPath), { attendees: nextAttendees, restPlayers: nextRest });
                    
                } else {
                    // 🔥 2. [진행중 상태] 클릭 시: 실시간 제어 스위치 가동
                    if (window.isAdminMode) {
                        const mode = confirm(`[${pName}] 님 상태 변경\n\n확인(OK) : 💤 대기열 제외 (쉼터 이동)\n취소(Cancel) : ❌ 오늘 정모 불참 (명단 완전 삭제)`);
                        if (mode) {
                            if(!nextRest.includes(pId)) nextRest.push(pId);
                            
                            let updatedMatches = currentMatches.filter(m => {
                                if (m.status === "대기") {
                                    const hasMe = [...(m.teamA || []), ...(m.teamB || [])].map(id => parseInt(id)).includes(pId);
                                    return !hasMe;
                                }
                                return true;
                            });

                            const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
                            update(ref(db, targetPath), { restPlayers: nextRest, currentMatches: updatedMatches }).then(() => recalculateLiveQueueMatch());
                        } else {
                            if (confirm(`⚠️ 정말로 [${pName}] 님을 오늘 정모 명단에서 완전히 삭제하시겠습니까?`)) {
                                nextAttendees = nextAttendees.filter(x => x !== pId);
                                nextRest = nextRest.filter(x => x !== pId);
                                
                                let updatedMatches = currentMatches.filter(m => {
                                    if (m.status === "대기") {
                                        const hasMe = [...(m.teamA || []), ...(m.teamB || [])].map(id => parseInt(id)).includes(pId);
                                        return !hasMe;
                                    }
                                    return true;
                                });

                                const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
                                update(ref(db, targetPath), { attendees: nextAttendees, restPlayers: nextRest, currentMatches: updatedMatches }).then(() => recalculateLiveQueueMatch());
                            }
                        }
                    } else {
                        if(!nextRest.includes(pId)) nextRest.push(pId);
                        
                        let updatedMatches = currentMatches.filter(m => {
                            if (m.status === "대기") {
                                const hasMe = [...(m.teamA || []), ...(m.teamB || [])].map(id => parseInt(id)).includes(pId);
                                return !hasMe;
                            }
                            return true;
                        });

                        const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
                        update(ref(db, targetPath), { restPlayers: nextRest, currentMatches: updatedMatches }).then(() => recalculateLiveQueueMatch());
                    }
                }
            } else {
                alert("🔒 본인의 상태만 변경할 수 있습니다.");
            }
        };
    });

    // 쉼터 무대 복귀 핸들러 (진행중 전용)
    document.querySelectorAll('.btn-toggle-rest').forEach(btn => {
        btn.onclick = function() {
            const pId = parseInt(this.getAttribute('data-id'));
            const pName = this.getAttribute('data-name');
            const isMe = pName === myFixedName && myFixedName !== "";

            if (window.isAdminMode || isMe) {
                if (confirm(`🏸 [${pName}] 님을 대기열에 다시 복귀시켜 매칭에 참여합니까?`)) {
                    const nextRest = restList.filter(x => x !== pId);
                    const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
                    update(ref(db, targetPath), { restPlayers: nextRest }).then(() => {
                        if(s.status === "진행중") recalculateLiveQueueMatch();
                    });
                }
            } else {
                alert("🔒 본인의 상태만 변경할 수 있습니다.");
            }
        };
    });
}

if (!window.liveMatchTimerInterval) { window.liveMatchTimerInterval = null; }

// ==========================================
// 🏟️ 실시간 추천 대진 카드 보드 렌더러
// ==========================================
function renderLiveCourtsGrid(s) {
    const liveContainer = document.getElementById('liveCourtsContainer'); if (!liveContainer) return;
    const currentMatches = s.currentMatches || []; const historyLog = s.historyLog || [];
    const myFixedName = localStorage.getItem("my_badminton_name") || "";
    
    const isObserverMode = (myFixedName === "" || myFixedName === "-- 일반 관람 모드 --");

    if (window.liveMatchTimerInterval) { clearInterval(window.liveMatchTimerInterval); window.liveMatchTimerInterval = null; }

    if (s.status === "예정") {
        liveContainer.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">대기중 채널입니다. 매칭 가동 시작 시 대진표가 개방됩니다.</div>`;
        return;
    }

    if(s.status === "종료") {
        if(historyLog.length === 0) { liveContainer.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs bg-white border border-dashed rounded-2xl">기록 없음</div>`; return; }
        liveContainer.innerHTML = [...historyLog].reverse().map((m, idx) => {
            const aNames = getNamesFromIds(m.teamA, m.teamANames).join(', '); const bNames = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
            const winA = m.scoreA > m.scoreB;
            const borderA = winA ? "border-2 border-emerald-400 bg-emerald-50/10 shadow-sm" : "border border-rose-200 bg-rose-50/10";
            const borderB = !winA ? "border-2 border-emerald-400 bg-emerald-50/10 shadow-sm" : "border border-rose-200 bg-rose-50/10";

            return `
                <div class="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-3xs space-y-2.5">
                    <div class="text-[10px] font-mono text-slate-400">🏁 제 ${historyLog.length - idx}경기 최종 결과</div>
                    <div class="grid grid-cols-2 gap-3 text-center text-xs">
                        <div class="p-2 rounded-xl flex justify-between items-center font-bold ${borderA}"><span>${aNames}</span> <span class="font-mono font-black">${m.scoreA}</span></div>
                        <div class="p-2 rounded-xl flex justify-between items-center font-bold ${borderB}"><span class="font-mono font-black">${m.scoreB}</span> <span>${bNames}</span></div>
                    </div>
                </div>`;
        }).join('');
        return;
    }

    if (currentMatches.length === 0) { liveContainer.innerHTML = `<div class="text-center py-10 text-slate-400 text-xs">코트 대기열 매칭 조합 컴파일 중...</div>`; return; }

    let isMyMatchDetectedInList = false;

    liveContainer.innerHTML = currentMatches.map((m, idx) => {
        if (m.status === "완료") return '';
        
        const aNames = getNamesFromIds(m.teamA, m.teamANames); 
        const bNames = getNamesFromIds(m.teamB, m.teamBNames);
        const aNamesStr = aNames.join(', '); 
        const bNamesStr = bNames.join(', ');
        
        const isHoldingMode = !m.teamB || m.teamB.length === 0;
        
        // 🎯 [04 패치 적용]: 괄호 데이터 제거 가공 및 정밀한 당사자 검색 동기화 패치
        const allMatchPlayerNames = aNames.concat(bNames).map(n => n.split('(')[0].trim());
        const cleanMyName = myFixedName.split('(')[0].trim();
        
        const isMyMatch = !isObserverMode && allMatchPlayerNames.includes(cleanMyName);
        const isLive = m.status === "진행중";
        
        if (isMyMatch) { isMyMatchDetectedInList = true; }
        
        let cardBg = "";
        if (isMyMatch) {
            cardBg = "my-neon-match-card bg-amber-50/40 scale-[1.01] border-amber-400 shadow-lg ring-2 ring-amber-400/20";
        } else if (isLive) {
            cardBg = "border border-indigo-400 bg-indigo-50/40 shadow-md";
        } else if (isHoldingMode) {
            cardBg = "border border-dashed border-slate-300 bg-slate-50/50";
        } else {
            cardBg = "border border-slate-200 bg-white";
        }

        let ctrlBtn = '';
        if (!isHoldingMode && (isMyMatch || window.isAdminMode)) {
            ctrlBtn = isLive 
                ? `<button data-id="${m.id}" class="btn-open-score bg-emerald-600 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-xl cursor-pointer shadow-xs">🛑 경기 종료</button>` 
                : `<button data-id="${m.id}" class="bg-indigo-600 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-xl cursor-pointer shadow-xs btn-start-match">▶ 경기시작</button>`;
        }
        
        const aiBtn = (!isHoldingMode && window.isAdminMode && isLive && s.isTestMode) 
            ? `<button data-id="${m.id}" class="btn-ai-simulate bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-[10px] px-2.5 py-1.5 rounded-xl ml-1 cursor-pointer">🤖 AI정산</button>` 
            : '';

        let statusBadge = '';
        if (isLive) {
            statusBadge = `
                <div class="flex items-center gap-1.5 text-rose-600 font-black text-xs">
                    <span class="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse-red"></span>
                    <span class="mr-1">⚡ 진행중</span>
                    <span class="match-live-stopwatch font-mono bg-rose-100 px-2 py-0.5 rounded-lg text-rose-700" data-start="${m.startedAt || Date.now()}">00:00</span>
                </div>`;
        } else if (isHoldingMode) {
            statusBadge = `
                <div class="flex items-center justify-between w-full">
                    <span class="text-[11px] font-black font-sans text-slate-500">⏳ 밸런스 매칭 대기 중</span>
                    <span class="text-[10px] font-bold bg-slate-400 text-white px-2 py-0.5 rounded-lg">동등 실력 라이벌 탐색 중...</span>
                </div>`;
        } else {
            statusBadge = `
                <div class="flex items-center justify-between w-full">
                    <span class="text-[11px] font-black font-sans text-amber-600">⏳ 추천대진 ${idx + 1}순위 ${isMyMatch ? '🔥 내 경기!':''}</span>
                    <span class="text-[10px] font-black bg-amber-500 text-white px-2 py-0.5 rounded-lg animate-pulse">🚨 코트에 입장해 주세요</span>
                </div>`;
        }

        return `
            <div class="bg-white rounded-2xl p-4 border transition-all space-y-3 ${cardBg}">
                <div class="flex justify-between items-center border-b border-slate-100/80 pb-2">
                    ${statusBadge}
                    <div class="flex items-center">${ctrlBtn}${aiBtn}</div>
                </div>
                <div class="grid grid-cols-7 text-center items-center text-xs font-black text-slate-800">
                    <div class="col-span-3 bg-slate-50 border border-slate-200/60 p-2 rounded-xl truncate">${aNamesStr}</div>
                    <div class="col-span-1 text-slate-300 font-mono">${isHoldingMode ? '🔍' : 'VS'}</div>
                    <div class="col-span-3 ${isHoldingMode ? 'bg-slate-100/70 text-slate-400 font-medium italic border border-dashed border-slate-200' : 'bg-slate-50 border border-slate-200/60 font-black text-slate-800'} p-2 rounded-xl truncate">
                        ${bNamesStr}
                    </div>
                </div>
            </div>`;
    }).join('');

    const timerNodes = document.querySelectorAll('.match-live-stopwatch');
    if (timerNodes.length > 0) {
        const updateClocks = () => {
            timerNodes.forEach(node => {
                const startTime = parseInt(node.getAttribute('data-start'));
                const diffMs = Date.now() - startTime;
                if (diffMs < 0) { node.innerText = "00:00"; return; }
                
                const totalSec = Math.floor(diffMs / 1000);
                const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
                const sec = String(totalSec % 60).padStart(2, '0');
                node.innerText = `${min}:${sec}`;
            });
        };
        updateClocks();
        window.liveMatchTimerInterval = setInterval(updateClocks, 1000);
    }

    const b1 = document.getElementById('myMatchNotificationBadge');
    const b2 = document.getElementById('myMatchNotificationBadgeSolid');
    if (b1 && b2) {
        if (isMyMatchDetectedInList && window.currentActiveMobileTabId !== 'sec-courts') {
            b1.classList.remove('hidden'); b2.classList.remove('hidden');
        } else {
            b1.classList.add('hidden'); b2.classList.add('hidden');
        }
    }

    // 1. 경기 시작 버튼 리스너
    document.querySelectorAll('.btn-start-match').forEach(btn => {
        btn.onclick = function() {
            const mId = this.getAttribute('data-id'); const target = currentMatches.find(x => x.id === mId); if(!target) return;
            const names = getNamesFromIds(target.teamA, target.teamANames).concat(getNamesFromIds(target.teamB, target.teamBNames));
            const cleanTargetNames = names.map(n => n.split('(')[0].trim());
            const myCleanName = myFixedName.split('(')[0].trim();

            if(window.isAdminMode || cleanTargetNames.includes(myCleanName)) {
                target.status = "진행중"; 
                target.startedAt = Date.now();
                const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
                update(ref(db, targetPath), { currentMatches });
            } else { alert("🔒 대진 당사자 본인이 아니거나 관리자가 아닙니다."); }
        };
    });

    // 2. 경기 종료 버튼 리스너 (점수 입력창 open)
    document.querySelectorAll('.btn-open-score').forEach(btn => {
        btn.onclick = function() {
            const mId = this.getAttribute('data-id'); const target = currentMatches.find(x => x.id === mId); if(!target) return;
            const targetMatchNames = getNamesFromIds(target.teamA, target.teamANames).concat(getNamesFromIds(target.teamB, target.teamBNames));
            const cleanTargetNames = targetMatchNames.map(n => n.split('(')[0].trim());
            const myCleanName = myFixedName.split('(')[0].trim();
            
            if (window.isAdminMode || cleanTargetNames.includes(myCleanName)) { openScoreModal(mId); } 
            else { alert("🔒 해당 경기의 출전 선수 4인 또는 마스터 관리자만 [경기 종료] 및 스코어 입력 권한이 있습니다!"); }
        };
    });

    // 🎯 경기종료창 잘못 눌렀을 때 닫아주는 ✕ 단추 리스너 분기
    const scoreModalCloseBtn = document.getElementById('btnCloseScoreModal') || document.getElementById('btnCloseModal');
    if (scoreModalCloseBtn) {
        scoreModalCloseBtn.onclick = function() {
            const scoreModal = document.getElementById('scoreModal');
            if (scoreModal) {
                scoreModal.classList.add('hidden');
            }
        };
    }

    // 3. AI 정산 매크로 단추 리스너
    document.querySelectorAll('.btn-ai-simulate').forEach(btn => {
        btn.onclick = function() {
            const mId = this.getAttribute('data-id');
            if (typeof handleAiSimulatedMatchCalculation === "function") {
                handleAiSimulatedMatchCalculation(mId);
            }
        };
    });

    // 4. 대진 전체 자동화 시뮬레이션 루프 리스너
    const btnFullSim = document.getElementById('btnLiveFullSimulation');
    if (btnFullSim) {
        if (window.isAdminMode && s.isTestMode) {
            btnFullSim.classList.remove('hidden');
            btnFullSim.onclick = function() {
                if (confirm("🚨 경고: 현재 출석된 실제 명단과 실시간 MMR을 기반으로 30경기 자동 매칭 및 ELO 승률 예측 정산 매크로를 즉시 가동합니까?\n\n(실제 파이어베이스 DB 데이터가 연속 갱신됩니다.)")) {
                    runLiveDatabaseSimulationLoop();
                }
            };
        } else {
            btnFullSim.classList.add('hidden');
        }
    }
}

// ==========================================
// 🤖 마스터 관리자 전용 AI 모의 정산 코어 엔진
// ==========================================
function handleAiSimulatedMatchCalculation(matchId) {
    if (!window.isAdminMode) { alert("🔒 마스터 관리자 모드에서만 테스트 가동할 수 있는 단추입니다."); return; }
    if (!window.currentSessionKey) { alert("⚠️ 활성화된 세션 키를 찾을 수 없습니다."); return; }

    const s = window.currentActiveSession;
    if (!s) { alert("⚠️ 현재 세션 데이터를 동기화하지 못했습니다. 잠시 후 다시 시도해 주세요."); return; }

    const currentMatches = s.currentMatches || [];
    const historyLog = s.historyLog || [];
    let statsLog = s.statsLog || {};
    
    const targetIdx = currentMatches.findIndex(x => x.id === matchId);
    if (targetIdx === -1) { alert("⚠️ 정산 대상 대진을 리스트에서 찾을 수 없습니다."); return; }
    
    const match = currentMatches[targetIdx];
    
    const scoreA = Math.floor(Math.random() * 6) + 20; 
    const scoreB = Math.floor(Math.random() * 6) + 20; 
    
    let finalScoreA = scoreA;
    let finalScoreB = scoreB;
    if (finalScoreA === finalScoreB) {
        finalScoreA = 25; finalScoreB = 23;
    } else if (finalScoreA > finalScoreB) {
        finalScoreA = 25;
    } else {
        finalScoreB = 25;
    }

    match.status = "완료";
    match.scoreA = finalScoreA;
    match.scoreB = finalScoreB;
    match.endedAt = Date.now();

    if (match.teamA && match.teamB && match.teamA.length === 2 && match.teamB.length === 2) {
        historyLog.push(match);

        const winTeamA = finalScoreA > finalScoreB;
        let sumA = 0, sumB = 0;
        match.teamA.forEach(id => { sumA += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
        match.teamB.forEach(id => { sumB += (window.allSystemPlayers.find(x => x.id === id)?.displayMmr || 1500); });
        
        const expA = 1 / (1 + Math.pow(10, ((sumB/2) - (sumA/2)) / 400));
        const expB = 1 / (1 + Math.pow(10, ((sumA/2) - (sumB/2)) / 400));
        const deltaA = Math.round(32 * ((winTeamA ? 1 : 0) - expA));
        const deltaB = Math.round(32 * ((!winTeamA ? 1 : 0) - expB));

        [...match.teamA, ...match.teamB].forEach(id => { if(!statsLog[id]) statsLog[id] = { win: 0, lose: 0, delta: 0 }; });
        match.teamA.forEach(id => { if(winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaA; });
        match.teamB.forEach(id => { if(!winTeamA) statsLog[id].win++; else statsLog[id].lose++; statsLog[id].delta += deltaB; });
    }

    const nextMatches = currentMatches.filter(x => x.id !== matchId);

    // 🎯 [01 패치 적용]: AI 정산 실행 시 테스트 모드 유무에 의거한 임시 경로 타겟 우회
    const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
    const sessionRef = ref(db, targetPath);

    update(sessionRef, {
        currentMatches: nextMatches,
        historyLog: historyLog,
        statsLog: statsLog 
    }).then(() => {
        console.log("🤖 AI 정산 동기화 마감 완료");
        s.currentMatches = nextMatches;
        s.historyLog = historyLog;
        s.statsLog = statsLog;
        renderSessionRankTable(s); 
        if (typeof recalculateLiveQueueMatch === "function") {
            recalculateLiveQueueMatch();
        }
    }).catch((err) => {
        alert("DB 정산 반영 실패: " + err.message);
    });
}

// 🎯 팀 조합 히스토리를 분석하여 최적의 조합을 반환하는 내포 함수
function createBalancedTeamsWithHistory(group, historyLog) {
    const cleanGroup = group.map(id => parseInt(id));

    const combos = [
        [
            [cleanGroup[0], cleanGroup[3]],
            [cleanGroup[1], cleanGroup[2]]
        ],
        [
            [cleanGroup[0], cleanGroup[2]],
            [cleanGroup[1], cleanGroup[3]]
        ],
        [
            [cleanGroup[0], cleanGroup[1]],
            [cleanGroup[2], cleanGroup[3]]
        ]
    ];

    const recentMatches = historyLog
        .filter(m =>
            m.teamA &&
            m.teamB &&
            m.teamA.length === 2 &&
            m.teamB.length === 2
        )
        .slice(-20);

    const countPairHistory = (p1, p2) => {
        let count = 0;
        recentMatches.forEach(m => {
            const teamA = (m.teamA || []).map(id => parseInt(id));
            const teamB = (m.teamB || []).map(id => parseInt(id));
            const teams = [teamA, teamB];
            
            teams.forEach(team => {
                if (team.includes(parseInt(p1)) && team.includes(parseInt(p2))) {
                    count++;
                }
            });
        });
        return count;
    };

    let bestCombo = combos[0];
    let bestScore = Infinity;

    combos.forEach(combo => {
        const teamA = combo[0];
        const teamB = combo[1];

        const score =
            countPairHistory(teamA[0], teamA[1]) +
            countPairHistory(teamB[0], teamB[1]);

        if (score < bestScore) {
            bestScore = score;
            bestCombo = combo;
        }
    });

    return {
        teamA: bestCombo[0],
        teamB: bestCombo[1]
    };
}

function recalculateLiveQueueMatch() {
    const s = window.currentActiveSession;
    if (!s || s.status !== "진행중" || window.allSystemPlayers.length === 0) return;

    let currentMatches = s.currentMatches || [];
    
    const attendees = (s.attendees || []).map(id => parseInt(id));
    const restList = (s.restPlayers || []).map(id => parseInt(id));
    const historyLog = s.historyLog || [];
    const maxCourts = s.courts || 2;

    const sortedPlayers = [...window.allSystemPlayers]
        .sort((a, b) => b.displayMmr - a.displayMmr);

    const rankMap = {};
    sortedPlayers.forEach((p, idx) => {
        if (p && p.id) rankMap[parseInt(p.id)] = idx + 1;
    });

    let playCounts = {};
    attendees.forEach(id => playCounts[id] = 0);

    historyLog.forEach(m => {
        if (
            !m.teamA ||
            !m.teamB ||
            m.teamA.length !== 2 ||
            m.teamB.length !== 2
        ) {
            return;
        }

        const matchPlayers = [...m.teamA, ...m.teamB].map(id => parseInt(id));
        matchPlayers.forEach(id => {
            if (playCounts[id] !== undefined) {
                playCounts[id]++;
            }
        });
    });

    const activePlayCounts = attendees
        .filter(id => !restList.includes(id))
        .map(id => playCounts[id] || 0);

    const maxPlayCount =
        activePlayCounts.length > 0
            ? Math.max(...activePlayCounts)
            : 0;

    const getAdjustedCount = (id) =>
        Math.min(playCounts[id] || 0, maxPlayCount);

    const getRecentPartnerMap = () => {
        const map = {};
        
        const validMatches = historyLog.filter(m => 
            m.teamA && m.teamB && m.teamA.length === 2 && m.teamB.length === 2
        );
        
        const recentCycleMatches = validMatches.slice(-maxCourts);

        recentCycleMatches.forEach(m => {
            const players = [...m.teamA, ...m.teamB].map(id => parseInt(id));
            
            players.forEach(player => {
                if (!map[player]) {
                    map[player] = [];
                }
                players.forEach(id => {
                    if (id !== player && !map[player].includes(id)) {
                        map[player].push(id);
                    }
                });
            });
        });

        return map;
    };

    const recentPartnerMap = getRecentPartnerMap();

    const canJoinGroup = (candidate, group) => {
        const cId = parseInt(candidate);
        for (const member of group) {
            const mId = parseInt(member);
            const recent = recentPartnerMap[mId] || [];
            if (recent.includes(cId)) {
                return false;
            }
        }
        return true;
    };

    let finalMatches = currentMatches.filter(
        m => m.status === "진행중"
    );

    let holdMatches = currentMatches.filter(
        m => m.status === "대기" && (!m.teamB || m.teamB.length === 0)
    ).slice(0, 1);

    let busyIds = new Set(restList);

    finalMatches.forEach(m => {
        (m.teamA || []).forEach(id => busyIds.add(parseInt(id)));
        (m.teamB || []).forEach(id => busyIds.add(parseInt(id)));
    });

    const getRealMatchCount = () => {
        return finalMatches.filter(m =>
            m.teamA && m.teamB && m.teamA.length === 2 && m.teamB.length === 2
        ).length;
    };

    // =========================
    // 기존 홀딩방 우선 채우기
    // =========================
    let freePlayers = attendees.filter(id => !busyIds.has(id));

    holdMatches.forEach(hold => {
        let group = (hold.teamA || []).map(id => parseInt(id));
        group.forEach(id => busyIds.add(id));

        while (group.length < 4) {
            const anchorRank = rankMap[group[0]];

            let candidate = freePlayers.find(id => {
                const cId = parseInt(id);
                if (group.includes(cId)) return false;
                const rank = rankMap[cId];
                
                // 🎯 [02 패치 연동]: 첫 매치이거나 이력이 아예 없을 땐 홀딩 방지용 가드 완화
                const dynamicGuardRange = (historyLog.length === 0) ? 99 : 4;
                if (Math.abs(rank - anchorRank) > dynamicGuardRange) return false;
                return canJoinGroup(cId, group);
            });

            if (!candidate) {
                candidate = freePlayers.find(id => {
                    const cId = parseInt(id);
                    if (group.includes(cId)) return false;
                    const rank = rankMap[cId];
                    const dynamicGuardRange = (historyLog.length === 0) ? 99 : 4;
                    return Math.abs(rank - anchorRank) <= dynamicGuardRange;
                });
            }

            if (!candidate) break;

            const finalCandidateId = parseInt(candidate);
            group.push(finalCandidateId);
            busyIds.add(finalCandidateId);
            freePlayers = freePlayers.filter(x => parseInt(x) !== finalCandidateId);
        }

        if (group.length === 4) {
            const players = group
                .map(id => window.allSystemPlayers.find(p => p.id === id))
                .filter(Boolean)
                .sort((a, b) => b.displayMmr - a.displayMmr);

            const teamResult = createBalancedTeamsWithHistory(
                players.map(p => p.id),
                historyLog
            );

            const teamA = teamResult.teamA;
            const teamB = teamResult.teamB;

            finalMatches.push({
                id: `m_${Date.now()}_${Math.random()}`,
                status: "대기",
                teamA,
                teamB,
                teamANames: getNamesFromIds(teamA),
                teamBNames: getNamesFromIds(teamB)
            });
        } else {
            finalMatches.push({
                ...hold,
                teamA: group,
                teamANames: getNamesFromIds(group)
            });
        }
    });

    // =========================
    // 신규 매칭 생성
    // =========================
    let freshQueue = attendees
        .filter(id => !busyIds.has(id))
        .sort((a, b) => getAdjustedCount(a) - getAdjustedCount(b));

    while (
        getRealMatchCount() < maxCourts &&
        freshQueue.length > 0
    ) {
        const anchorId = freshQueue[0];
        const anchorRank = rankMap[anchorId];
        let group = [anchorId];

        // 🎯 [02 패치 적용]: 첫 게임 시작 사이클 시 홀딩방 차단을 위한 격차 가드 자동 해제 연산
        const dynamicLimit = (historyLog.length === 0) ? 99 : 4;

        for (let i = 1; i < freshQueue.length; i++) {
            const candidate = freshQueue[i];
            const rank = rankMap[candidate];

            if (Math.abs(rank - anchorRank) > dynamicLimit) continue;
            if (canJoinGroup(candidate, group)) {
                group.push(candidate);
            }
            if (group.length === 4) break;
        }

        if (group.length < 4) {
            for (let i = 1; i < freshQueue.length; i++) {
                const candidate = freshQueue[i];
                if (group.includes(candidate)) continue;
                const rank = rankMap[candidate];

                if (Math.abs(rank - anchorRank) <= dynamicLimit) {
                    group.push(candidate);
                }
                if (group.length === 4) break;
            }
        }

        if (group.length === 4) {
            const players = group
                .map(id => window.allSystemPlayers.find(p => p.id === id))
                .filter(Boolean)
                .sort((a, b) => b.displayMmr - a.displayMmr);

            const teamResult = createBalancedTeamsWithHistory(
                players.map(p => p.id),
                historyLog
            );

            const teamA = teamResult.teamA;
            const teamB = teamResult.teamB;

            finalMatches.push({
                id: `m_${Date.now()}_${finalMatches.length}`,
                status: "대기",
                teamA,
                teamB,
                teamANames: getNamesFromIds(teamA),
                teamBNames: getNamesFromIds(teamB)
            });
        } else {
            const alreadyHasHold = finalMatches.some(m => !m.teamB || m.teamB.length === 0);

            if (!alreadyHasHold) {
                finalMatches.push({
                    id: `hold_${anchorId}`,
                    status: "대기",
                    teamA: group,
                    teamB: [],
                    teamANames: getNamesFromIds(group),
                    teamBNames: []
                });
            }
        }

        group.forEach(id => busyIds.add(id));
        freshQueue = freshQueue.filter(id => !busyIds.has(id));
    }

    // 🎯 [01 패치 적용]: 대진 큐 데이터셋 갱신 시 실서버 데이터 보호 격리 주입
    const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
    update(
        ref(db, targetPath),
        { currentMatches: finalMatches }
    );
}

function renderSessionRankTable(s) {
    const tbody = document.getElementById('sessionLiveRankTableBody');
    if (!tbody || window.allSystemPlayers.length === 0) return;
    
    const attendees = s.attendees || [];
    const statsLog = s.statsLog || {}; 

    let list = attendees.map(id => {
        const p = window.allSystemPlayers.find(x => x.id === parseInt(id));
        const log = statsLog[id] || {}; 
        return {
            name: p ? p.name : `회원(${id})`,
            baseMmr: p ? p.displayMmr : 1000,
            win: log.win || 0,
            lose: log.lose || 0,
            delta: log.delta || 0
        };
    });

    if (list.length === 0) {
        list = Object.entries(statsLog).map(([id, log]) => {
            const p = window.allSystemPlayers.find(x => x.id === parseInt(id));
            return {
                name: p ? p.name : id,
                baseMmr: p ? p.displayMmr : 1000,
                win: log.win || 0,
                lose: log.lose || 0,
                delta: log.delta || 0
            };
        });
    }

    if (window.currentSortMode === "MMR_DESC") {
        list.sort((a, b) => (b.baseMmr + b.delta) - (a.baseMmr + a.delta));
    } else if (window.currentSortMode === "MMR_ASC") {
        list.sort((a, b) => (a.baseMmr + a.delta) - (b.baseMmr + b.delta));
    } else if (window.currentSortMode === "DELTA_DESC") {
        list.sort((a, b) => b.delta - a.delta);
    } else if (window.currentSortMode === "DELTA_ASC") {
        list.sort((a, b) => a.delta - b.delta);
    }

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-xs text-slate-400 italic">현재 출석하거나 경기한 회원이 없어 성적표가 비어있습니다.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((p, idx) => {
        const total = p.win + p.lose;
        const winRate = total > 0 ? Math.round((p.win / total) * 100) : 0;
        const currentTotalMmr = p.baseMmr + p.delta; 
        
        const deltaColor = p.delta >= 0 ? 'text-emerald-600' : 'text-rose-600';
        const deltaText = p.delta > 0 ? `(+${p.delta})` : (p.delta < 0 ? `(${p.delta})` : `(0)`);
        const isHot = window.currentSortMode === "MMR_DESC" && idx === 0 && p.win > 0;

        return `
            <tr class="${isHot ? 'bg-amber-50/40 text-red-500 font-bold' : ''}">
                <td class="py-2 font-bold">${p.name}${isHot ? ' 🔥' : ''}</td>
                <td class="py-2 text-center font-mono text-slate-600 text-xs">${p.win}승 ${p.lose}패</td>
                <td class="py-2 text-center font-mono text-xs font-bold text-indigo-600">${winRate}%</td>
                <td class="py-2 text-right font-mono text-xs font-black text-slate-900">
                    ${currentTotalMmr}점 <span class="font-bold ${deltaColor}">${deltaText}</span>
                </td>
            </tr>`;
    }).join('');
}

let scoreModalTargetMatchId = null;
function openScoreModal(mId) {
    scoreModalTargetMatchId = mId; const m = window.currentActiveSession.currentMatches.find(x => x.id === mId); if (!m) return;
    document.getElementById('modalTeamANames').innerText = getNamesFromIds(m.teamA, m.teamANames).join(', ');
    document.getElementById('modalTeamBNames').innerText = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
    
    const btnWinA = document.getElementById('btnWinASelector');
    const btnWinB = document.getElementById('btnWinBSelector');
    if (btnWinA && btnWinB) {
        btnWinA.removeAttribute('data-winner');
        btnWinB.removeAttribute('data-winner');
        btnWinA.className = "bg-slate-100 text-slate-700 font-black px-2.5 py-1.5 rounded-lg border border-slate-300 transition-all";
        btnWinB.className = "bg-slate-100 text-slate-700 font-black px-2.5 py-1.5 rounded-lg border border-slate-300 transition-all";
    }
    
    document.getElementById('inputScoreA').value = ''; 
    document.getElementById('inputScoreB').value = '';
    document.getElementById('scoreModal').classList.remove('hidden');
}

if(document.getElementById('btnSubmitMatchScore')) {
    document.getElementById('btnSubmitMatchScore').onclick = function() {
        const btnWinA = document.getElementById('btnWinASelector');
        const btnWinB = document.getElementById('btnWinBSelector');
        let sel = "";
        if (btnWinA.hasAttribute('data-winner')) sel = "A";
        if (btnWinB.hasAttribute('data-winner')) sel = "B";
        
        if(!sel) { alert("🥇 어느 팀이 승리했는지 [승리] 버튼을 선택해 주세요!"); return; }
        
        const sA = parseInt(document.getElementById('inputScoreA').value); 
        const sB = parseInt(document.getElementById('inputScoreB').value);
        if (isNaN(sA) || isNaN(sB) || sA === sB) { alert("❌ 양 팀 점수를 정확히 입력해 주세요. (무승부 불가)"); return; }
        if (sel === 'A' && sA < sB) { alert("⚠️ TEAM A가 승리팀으로 마킹되었으나 점수가 더 낮습니다."); return; }
        if (sel === 'B' && sB < sA) { alert("⚠️ TEAM B가 승리팀으로 마킹되었으나 점수가 더 낮습니다."); return; }

        const s = window.currentActiveSession; 
        let currentMatches = s.currentMatches || []; 
        let historyLog = s.historyLog || []; 
        let statsLog = s.statsLog || {};
        
        const mIdx = currentMatches.findIndex(x => x.id === scoreModalTargetMatchId); 
        if (mIdx === -1) return;
        
        let match = currentMatches[mIdx];
        const myFixedName = localStorage.getItem("my_badminton_name") || "";
        const targetMatchNames = getNamesFromIds(match.teamA, match.teamANames).concat(getNamesFromIds(match.teamB, match.teamBNames));
        const cleanTargetNames = targetMatchNames.map(n => n.split('(')[0].trim());
        const myCleanName = myFixedName.split('(')[0].trim();
        
        if (!window.isAdminMode && !cleanTargetNames.includes(myCleanName)) {
            alert("🔒 해당 경기의 출전 선수 혹은 관리자만 결과를 전송할 권한이 있습니다!");
            return;
        }

        match.scoreA = sA; match.scoreB = sB; match.status = "완료";
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
        
        btnWinA.removeAttribute('data-winner');
        btnWinB.removeAttribute('data-winner');
        btnWinA.className = "bg-slate-100 text-slate-700 font-black px-2.5 py-1.5 rounded-lg border border-slate-300 transition-all";
        btnWinB.className = "bg-slate-100 text-slate-700 font-black px-2.5 py-1.5 rounded-xl border border-slate-300 transition-all";

        // 🎯 [01 패치 적용]: 수동 점수 기록 승인 버튼 전송 시 테스트 모드 우회 저장 마감
        const targetPath = s.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
        update(ref(db, targetPath), { currentMatches, historyLog, statsLog }).then(() => { 
            s.currentMatches = currentMatches;
            s.historyLog = historyLog;
            s.statsLog = statsLog;
            renderSessionRankTable(s);
            recalculateLiveQueueMatch(); 
        });
    };
}

function borderTrackAssign(q) {
    const container = document.getElementById('localSearchResultContainer'); if(!container || window.allSystemPlayers.length === 0) return;
    const query = q ? q.trim() : ""; if(!query) return;
    localStorage.setItem("my_badminton_name", query);
    const historyLog = window.currentActiveSession ? (window.currentActiveSession.historyLog || []) : [];
    const filtered = historyLog.filter(m => getNamesFromIds(m.teamA, m.teamANames).includes(query) || getNamesFromIds(m.teamB, m.teamBNames).includes(query)).reverse();
    
    container.innerHTML = filtered.map(m => {
        const winA = m.scoreA > m.scoreB;
        const borderA = winA ? "border border-emerald-400 bg-emerald-50/10" : "border border-rose-200 bg-rose-50/10";
        const borderB = !winA ? "border border-emerald-400 bg-emerald-50/10" : "border border-rose-200 bg-rose-50/10";
        return `
            <div class="bg-white border rounded-xl p-2.5 space-y-1 text-[11px]">
                <div class="grid grid-cols-2 gap-2 text-center font-bold text-slate-700">
                    <div class="p-1.5 rounded-lg flex justify-between ${borderA}"><span>${getNamesFromIds(m.teamA, m.teamANames).join(',')}</span> <span>${m.scoreA}</span></div>
                    <div class="p-1.5 rounded-lg flex justify-between ${borderB}"><span>${m.scoreB}</span> <span>${getNamesFromIds(m.teamB, m.teamBNames).join(',')}</span></div>
                </div>
            </div>`;
    }).join('');
}

function executeLocalRecordSearch(query) {
    const container = document.getElementById('localSearchResultContainer'); if(!container) return;
    const cleanQuery = (query || "").trim().split('(')[0].trim();

    document.querySelectorAll('#sessionLiveRankTableBody tr').forEach(row => {
        row.classList.remove('highlight-row');
    });

    if(!cleanQuery) {
        container.innerHTML = `<div class="text-slate-400 text-[10px] py-1 italic">조회할 회원의 이름을 입력해 주세요.</div>`;
        return;
    }

    let targetRow = null;
    document.querySelectorAll('#sessionLiveRankTableBody tr').forEach(row => {
        const nameCell = row.querySelector('td:first-child'); 
        if (nameCell) {
            const rowName = nameCell.innerText.split('(')[0].trim();
            if (rowName === cleanQuery) {
                targetRow = row;
            }
        }
    });

    if (targetRow) {
        targetRow.classList.add('highlight-row');
        setTimeout(() => {
            targetRow.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }, 50);
    }

    if (!window.currentActiveSession || !window.currentActiveSession.historyLog) {
        container.innerHTML = `<div class="text-slate-400 text-[10px] py-1">기록 데이터가 없습니다.</div>`;
        return;
    }

    const historyLog = window.currentActiveSession.historyLog || [];
    const myMatches = historyLog.filter(m => {
        const aNames = getNamesFromIds(m.teamA, m.teamANames).map(n => n.split('(')[0].trim());
        const bNames = getNamesFromIds(m.teamB, m.teamBNames).map(n => n.split('(')[0].trim());
        return aNames.includes(cleanQuery) || bNames.includes(cleanQuery);
    });

    if(myMatches.length === 0) {
        container.innerHTML = `<div class="text-slate-400 text-[10px] py-1">오늘 진행한 경기 기록이 없습니다.</div>`;
        return;
    }

    container.innerHTML = [...myMatches].reverse().map(m => {
        const aNames = getNamesFromIds(m.teamA, m.teamANames).join(', ');
        const bNames = getNamesFromIds(m.teamB, m.teamBNames).join(', ');
        
        const isTeamA = getNamesFromIds(m.teamA, m.teamANames).map(n => n.split('(')[0].trim()).includes(cleanQuery);
        const myScore = isTeamA ? m.scoreA : m.scoreB;
        const opScore = isTeamA ? m.scoreB : m.scoreA;
        const isWin = myScore > opScore;

        const resultBadge = isWin 
            ? `<span class="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] px-1.5 py-0.5 rounded-md font-black">WIN</span>`
            : `<span class="bg-rose-100 text-rose-800 border border-rose-300 text-[9px] px-1.5 py-0.5 rounded-md font-black">LOSE</span>`;

        return `
            <div class="bg-slate-50 border border-slate-200/70 p-2.5 rounded-xl text-[11px] space-y-1">
                <div class="flex justify-between items-center">
                    <span class="text-[9px] text-slate-400 font-mono">🎯 점수차: ${Math.abs(myScore - opScore)}점</span>
                    ${resultBadge}
                </div>
                <div class="text-slate-700 font-medium">
                    <span class="${isTeamA ? 'font-black text-indigo-600':''}">${aNames}</span> 
                    <span class="font-mono font-bold mx-1">${m.scoreA} : ${m.scoreB}</span> 
                    <span class="${!isTeamA ? 'font-black text-indigo-600':''}">${bNames}</span>
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

function bootAppEngine() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionUrlId = urlParams.get('id');

    if (sessionUrlId) {
        window.currentSessionKey = sessionUrlId;
        window.initSessionPage();
    } else if (document.getElementById('globalRankTableBody')) {
        window.initDashboardPage();
    }
}

if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", bootAppEngine); } 
else { bootAppEngine(); }

// =========================================================================
// 🤖 [마스터 시뮬레이터] 30경기 연속 자동 테스트 루프 마그넷 엔진
// =========================================================================
function runLiveDatabaseSimulationLoop() {
    let loopCount = 0;
    const maxLoops = 30; 

    function triggerNextAutoMatchAndSettlement() {
        if (loopCount >= maxLoops) {
            console.log(`🏁 [시뮬레이션 종료] 30경기 정산 완료.`);
            alert(`🏁 [라이브 시뮬레이션 종료] 총 ${maxLoops}경기 정산 완료!`);
            return;
        }

        // 🎯 [01 패치 적용]: 자동화 시뮬레이터 루프 가동 시 테스트 폴더 다이렉트 바인딩 스위칭
        const s = window.currentActiveSession;
        const targetPath = s?.isTestMode ? `test_sessions/${window.currentSessionKey}` : `sessions/${window.currentSessionKey}`;
        const sessionRef = ref(db, targetPath);

        get(sessionRef).then((snapshot) => {
            if (!snapshot.exists()) return;
            const liveSnapshot = snapshot.val();
            const currentMatches = liveSnapshot.currentMatches || [];
            const dynamicTargetScore = parseInt(liveSnapshot.targetScore) || 25;

            const activeMatches = currentMatches.filter(m => m.status !== "완료");
            if (activeMatches.length < (liveSnapshot.courts || 2)) {
                if (typeof recalculateLiveQueueMatch === "function") {
                    recalculateLiveQueueMatch();
                }
                setTimeout(triggerNextAutoMatchAndSettlement, 600);
                return;
            }

            const targetMatch = activeMatches[0];
            
            const teamAPlayers = targetMatch.teamA.map(id => window.allSystemPlayers.find(x => x.id === parseInt(id)) || { displayMmr: 1000 });
            const teamBPlayers = targetMatch.teamB.map(id => window.allSystemPlayers.find(x => x.id === parseInt(id)) || { displayMmr: 1000 });
            
            const avgMmrA = (teamAPlayers.reduce((acc, p) => acc + (p.displayMmr || 1000), 0)) / 2;
            const avgMmrB = (teamBPlayers.reduce((acc, p) => acc + (p.displayMmr || 1000), 0)) / 2;

            const mmrDiff = avgMmrB - avgMmrA;
            const penalty = (Math.abs(mmrDiff) > 100) ? 1.5 : 1.0;
            const effectiveDiff = mmrDiff * penalty;

            const expectedProbabilityA = 1 / (1 + Math.pow(10, (effectiveDiff / 300)));

            loopCount++;
            
            const dice = Math.random();
            let finalScoreA, finalScoreB;
            
            if (dice < expectedProbabilityA) {
                finalScoreA = dynamicTargetScore;
                finalScoreB = Math.max(0, dynamicTargetScore - (Math.floor(Math.random() * 10) + 5)); 
            } else {
                finalScoreA = Math.max(0, dynamicTargetScore - (Math.floor(Math.random() * 10) + 5));
                finalScoreB = dynamicTargetScore;
            }

            console.log(`🔥 제 ${loopCount}경기 | A:${Math.round(avgMmrA)} vs B:${Math.round(avgMmrB)} | A승률:${Math.round(expectedProbabilityA*100)}% | 결과 ${finalScoreA}:${finalScoreB}`);

            targetMatch.status = "완료";
            targetMatch.scoreA = finalScoreA;
            targetMatch.scoreB = finalScoreB;
            targetMatch.endedAt = Date.now();

            const historyLog = liveSnapshot.historyLog || [];
            historyLog.push(targetMatch);
            const nextMatches = currentMatches.filter(x => x.id !== targetMatch.id);

            update(sessionRef, {
                currentMatches: nextMatches,
                historyLog: historyLog
            }).then(() => {
                setTimeout(triggerNextAutoMatchAndSettlement, 200);
            });

        }).catch((err) => {
            console.error("루프 에러:", err);
            setTimeout(triggerNextAutoMatchAndSettlement, 1000);
        });
    }

    triggerNextAutoMatchAndSettlement();
}
