import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, get, update, push, remove, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// 🔴 본인의 열쇠로 교체하세요! 
const firebaseConfig = {
     apiKey: "AIzaSyDshai0geE4xEvD7Hl8ymGvWr2kw9tWbu8",
  authDomain: "pokemongraph.firebaseapp.com",
  projectId: "pokemongraph",
  storageBucket: "pokemongraph.firebasestorage.app",
  messagingSenderId: "238452990871",
  appId: "1:238452990871:web:4f55e0c329b0698253dad2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// HTML 요소 가져오기
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const adminPanel = document.getElementById('admin-panel');
const multiplierDisplay = document.getElementById('display-multiplier');
const bustedMsg = document.getElementById('busted-msg');
const countdownMsg = document.getElementById('countdown-msg');
const countdownSec = document.getElementById('countdown-sec');
const canvas = document.getElementById('graph-canvas');

let currentUser = null;
let currentDiscordId = "";
let currentCoin = 0;
let isAdmin = false;
let inactivityTimer;

// [회원가입, 로그인, 5분 자동 로그아웃 유지]
document.getElementById('btn-register').addEventListener('click', async () => { /* 내용 생략 없이 작성 요망 (기존과 동일) */
    const id = document.getElementById('user-id').value.trim();
    const pw = document.getElementById('user-pw').value.trim();
    if(id.length < 2 || pw.length < 6) return alert("아이디 2자, 비밀번호 6자 이상 입력!");
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, id + "@pokemon.com", pw);
        await set(ref(db, 'users/' + userCredential.user.uid), { discordId: id, coin: 0, role: "user" });
        alert("가입 성공!");
    } catch (e) { alert("오류: 중복된 아이디거나 가입 실패입니다."); }
});
document.getElementById('btn-login').addEventListener('click', async () => { /* 내용 생략 없이 작성 요망 */
    const id = document.getElementById('user-id').value.trim();
    const pw = document.getElementById('user-pw').value.trim();
    try { await signInWithEmailAndPassword(auth, id + "@pokemon.com", pw); } catch (e) { alert("아이디/비밀번호 오류!"); }
});
function resetTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => { alert("5분 미접속 자동 로그아웃"); signOut(auth); }, 300000);
}
window.addEventListener('mousemove', resetTimer); window.addEventListener('keydown', resetTimer);

// 로그인 상태 감지
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loginScreen.style.display = 'none';
        gameScreen.style.display = 'flex';
        resetTimer();

        onValue(ref(db, 'users/' + user.uid), (snapshot) => {
            const data = snapshot.val();
            if(data) {
                currentDiscordId = data.discordId;
                currentCoin = data.coin;
                isAdmin = (data.role === "admin");
                document.getElementById('display-username').innerText = data.discordId + " 님";
                document.getElementById('display-coin').innerText = data.coin.toLocaleString();
                
                if (isAdmin) {
                    adminPanel.style.display = 'block';
                    loadAdminData();
                } else { adminPanel.style.display = 'none'; }
            }
        });
    } else {
        currentUser = null;
        loginScreen.style.display = 'flex';
        gameScreen.style.display = 'none';
        adminPanel.style.display = 'none';
    }
});

// 충전/환전 신청
document.getElementById('btn-req-charge').addEventListener('click', () => {
    const amount = prompt("충전 신청 수량:");
    if (amount && !isNaN(amount) && amount > 0) push(ref(db, 'requests/charge'), { uid: currentUser.uid, discordId: currentDiscordId, amount: Number(amount) });
});
document.getElementById('btn-req-exchange').addEventListener('click', () => {
    const amount = prompt("환전 신청 수량:");
    if (amount && !isNaN(amount) && amount > 0) {
        if (Number(amount) > currentCoin) return alert("보유 코인 초과!");
        push(ref(db, 'requests/exchange'), { uid: currentUser.uid, discordId: currentDiscordId, amount: Number(amount) });
    }
});

// ----------------------------------------------------
// [핵심] 🎮 게임 엔진은 이제 Render 서버가 담당합니다! 🎮
// ----------------------------------------------------

function loadAdminData() {
    // 코인 지급 및 충전/환전 승인 로직 (이전과 동일)
    document.getElementById('btn-admin-give').onclick = async () => {
        const targetId = document.getElementById('admin-target-id').value.trim();
        const amount = Number(document.getElementById('admin-give-coin').value);
        if (!targetId || !amount) return;
        const q = query(ref(db, 'users'), orderByChild('discordId'), equalTo(targetId));
        const snapshot = await get(q);
        if (snapshot.exists()) {
            snapshot.forEach((child) => update(ref(db, 'users/' + child.key), { coin: child.val().coin + amount }));
            alert("지급 완료!");
        }
    };
    
    // 자동 발사기 버튼 기능 삭제 (이제 버튼을 누를 필요가 없음을 알림)
    const btnAuto = document.getElementById('btn-admin-auto');
    if(btnAuto) {
        btnAuto.innerText = "✅ Render 서버에서 24시간 자동 가동 중";
        btnAuto.style.backgroundColor = "#868E96"; // 비활성화 색상
        btnAuto.onclick = null; 
    }
}

// 📺 모든 유저 화면 렌더링 로직 (기존과 완전히 동일하게 유지!)
onValue(ref(db, 'game'), (snapshot) => {
    const game = snapshot.val();
    if (!game) return;

    if (game.status === 'waiting') {
        startCountdownVisuals(game.nextStartTime);
    } else if (game.status === 'running') {
        startGameVisuals(game.startTime, game.crashPoint);
    } else if (game.status === 'crashed') {
        stopGameVisuals(game.crashPoint);
    }
});

// ... (이하 startCountdownVisuals, startGameVisuals, stopGameVisuals 함수는 기존 코드 그대로 유지합니다)

function startCountdownVisuals(nextStartTime) {
    cancelAnimationFrame(gameAnimationId);
    cancelAnimationFrame(countdownAnimationId);
    
    bustedMsg.style.display = 'none';
    countdownMsg.style.display = 'block'; // 카운트다운 텍스트 켜기
    multiplierDisplay.innerText = "1.00x";
    multiplierDisplay.style.color = "#ADB5BD"; // 회색 텍스트
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height); // 이전 선 지우기

    const drawCountdown = () => {
        const remainMs = nextStartTime - Date.now();
        if (remainMs <= 0) {
            countdownSec.innerText = "0.0";
            return;
        }
        countdownSec.innerText = (remainMs / 1000).toFixed(1); // 0.1초 단위 텍스트 갱신
        countdownAnimationId = requestAnimationFrame(drawCountdown);
    };
    drawCountdown();
}

function startGameVisuals(startTime, crashPoint) {
    cancelAnimationFrame(gameAnimationId);
    cancelAnimationFrame(countdownAnimationId);
    countdownMsg.style.display = 'none';
    bustedMsg.style.display = 'none';
    
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const ctx = canvas.getContext('2d');

    const draw = () => {
        let elapsed = (Date.now() - startTime) / 1000;
        let currentMulti = 1.00 + (elapsed * 0.4);

        if (currentMulti >= crashPoint) currentMulti = crashPoint;

        multiplierDisplay.innerText = currentMulti.toFixed(2) + "x";
        multiplierDisplay.style.color = "#40C057";

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.moveTo(0, canvas.height);
        
        let progress = Math.min((currentMulti - 1) / 3, 1);
        let currentX = canvas.width * progress;
        let currentY = canvas.height - (canvas.height * progress);
        
        ctx.lineTo(currentX, currentY);
        ctx.strokeStyle = "#FFD43B";
        ctx.lineWidth = 6;
        ctx.stroke();

        if (currentMulti < crashPoint) {
            gameAnimationId = requestAnimationFrame(draw);
        }
    };
    draw();
}

function stopGameVisuals(crashPoint) {
    cancelAnimationFrame(gameAnimationId);
    cancelAnimationFrame(countdownAnimationId);
    
    countdownMsg.style.display = 'none';
    multiplierDisplay.innerText = crashPoint.toFixed(2) + "x";
    multiplierDisplay.style.color = "#FA5252";
    bustedMsg.style.display = 'block';
    
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = "#FA5252";
    ctx.stroke();
}