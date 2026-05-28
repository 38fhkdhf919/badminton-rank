import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// 관리자님의 파이어베이스 실제 정보로 교체 필수!
const firebaseConfig = {
      apiKey: "AIzaSyDOO3yMqRlzMgnoacdaT5kuNcJKQYC-8zQ",
      authDomain: "badminton-live-rank.firebaseapp.com",
      projectId: "badminton-live-rank",
      storageBucket: "badminton-live-rank.firebasestorage.app",
      messagingSenderId: "803402263930",
      appId: "1:803402263930:web:ebe85b833a86d6acd33ac3",
      measurementId: "G-SE2PTKXVDJ"
};

// 파이어베이스 및 리얼타임 DB 초기화
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// index.html에서 서버 연결 상태를 모니터링할 수 있도록 실시간 리스너 함수 정의
window.checkServerConnection = function(callback) {
    // 파이어베이스 DB의 'connectionTest' 경로를 바라봄
    const testRef = ref(db, 'connectionTest');
    
    // 해당 경로의 값이 바뀌면 브라우저 화면에 실시간으로 신호를 쏴줌
    onValue(testRef, (snapshot) => {
        const data = snapshot.val();
        callback(data);
    }, (error) => {
        console.error("파이어베이스 연결 실패 에러 원인:", error);
        callback("CONNECTION_ERROR");
    });
};

console.log("📡 app.js: 파이어베이스 연결 리스너 스크립트 대기 중...");
