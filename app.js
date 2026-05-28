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

// [기존 코드] 연결 테스트 리스너
window.checkServerConnection = function(callback) {
    const testRef = ref(db, 'connectionTest');
    onValue(testRef, (snapshot) => {
        const data = snapshot.val();
        callback(data);
    });
};

// 🔥 [신규 추가] 26명 명단 데이터를 파이어베이스 서버에 최초 업로드하는 함수
window.uploadMasterPlayers = function() {
    // 깃허브에 함께 올려둔 players.json 파일을 읽어옵니다.
    fetch('./players.json')
        .then(response => response.json())
        .then(data => {
            // 파이어베이스 DB의 'players' 라는 경로에 26명 데이터를 통째로 덮어씁니다.
            set(ref(db, 'players'), data)
                .then(() => {
                    alert("🚀 26명 마스터 명단이 파이어베이스 서버에 완벽하게 업로드되었습니다!");
                    location.reload(); // 성공 후 화면 새로고침
                })
                .catch(error => {
                    alert("❌ 업로드 실패: " + error);
                });
        })
        .catch(err => {
            alert("❌ players.json 파일을 읽어오는데 실패했습니다: " + err);
        });
};

console.log("💾 app.js: 마스터 명단 동기화 엔진 대기 중...");
