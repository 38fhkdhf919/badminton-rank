import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// 관리자님의 파이어베이스 주소 및 키 (싱가포르 주소 유지)
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

// 🔥 [신규 교체] 파이어베이스 서버의 players 데이터를 실시간으로 추적하여 전송하는 함수
window.listenToPlayers = function(callback) {
    const playersRef = ref(db, 'players');
    
    // 파이어베이스 내부의 players 데이터가 변경될 때마다 브라우저가 감지하여 자동 실행됨
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val();
        
        let playersList = [];
        if (data) {
            // 데이터가 빈 공간(null)을 포함할 수 있으므로 필터링 후 배열화
            playersList = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
        }
        
        // 데이터의 가시성을 위해 고유 ID 순서대로 오름차순 정렬
        playersList.sort((a, b) => a.id - b.id);
        
        // index.html의 화면 그리기 로직으로 데이터 토스
        callback(playersList);
    }, (error) => {
        console.error("파이어베이스 데이터 로드 실패:", error);
    });
};

console.log("👥 app.js: 실시간 회원 명단 구독 리스너 가동 중...");
