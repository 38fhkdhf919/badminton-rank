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

// 현재 실시간 회원들을 캐싱해둘 내부 변수 (다음 ID 자동 연산용)
let currentCachedPlayers = [];

// [기존 유지] 실시간 회원 명단 구독 리스너
window.listenToPlayers = function(callback) {
    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        let playersList = [];
        if (data) {
            playersList = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
        }
        playersList.sort((a, b) => a.id - b.id);
        
        currentCachedPlayers = playersList; // 최신 명단 내부 캐시에 복사보관
        callback(playersList);
    });
};

// 🔥 [신규 추가] 관리자가 입력한 신규 회원을 파이어베이스 서버에 안전하게 등록하는 함수
window.addNewPlayerToServer = function(name, age, tier, successCallback) {
    // 1. 현재 캐시된 유저들 중 가장 높은 ID를 찾아서 다음 ID(Next ID)를 계산합니다.
    let maxId = 0;
    if (currentCachedPlayers.length > 0) {
        maxId = Math.max(...currentCachedPlayers.map(p => p.id));
    }
    const nextId = maxId + 1;
    
    // 배열 인덱스상 꼬이지 않도록 파이어베이스의 저장할 순번 위치 설정
    const targetIndex = currentCachedPlayers.length;

    // 2. 새롭게 가입할 신규 회원의 표준 스펙 구조 정의
    const newPlayerData = {
        id: nextId,
        name: name,
        age: age,
        tier: tier,
        displayMmr: 1000,     // 초기 공식 점수 1000점 기본 부여
        matchMmr: 1000,       // 초기 히든 점수 1000점 기본 부여
        matchesPlayed: 0,     // 경기 수 0으로 초기화
        streak: 0             // 연승/연패 스트릭 0으로 초기화
    };

    // 3. 파이어베이스 실시간 서버의 다음 빈 칸에 데이터 저장 명령
    set(ref(db, `players/${targetIndex}`), newPlayerData)
        .then(() => {
            alert(`🎉 [ID: ${nextId}] ${name} 회원이 서버에 성공적으로 등록되었습니다!`);
            if (typeof successCallback === 'function') successCallback();
        })
        .catch((error) => {
            alert("❌ 서버 등록 오류 발생: " + error);
        });
};

console.log("✍️ app.js: 신규 유저 생성 트래커 모듈 준비 끝.");
