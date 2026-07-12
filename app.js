import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, get, update, push, remove, query, orderByChild, equalTo, limitToLast } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// 🔴 본인의 열쇠로 반드시 교체하세요!
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

const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const adminPanel = document.getElementById('admin-panel');
const multiplierDisplay = document.getElementById('display-multiplier');
const bustedMsg = document.getElementById('busted-msg');
const countdownMsg = document.getElementById('countdown-msg');
const countdownSec = document.getElementById('countdown-sec');
const canvas = document.getElementById('graph-canvas');
const btnBetting = document.getElementById('btn-betting');

let currentUser = null; let currentDiscordId = ""; let currentCoin = 0;
let isAdmin = false; let inactivityTimer;
let gameAnimationId; let countdownAnimationId;

let currentGameStatus = 'offline';
let myBetState = 'none'; 
let myBetAmount = 0;
let myAutoCashout = 0;
let currentLiveMultiplier = 1.00; // ⭐ 실시간 배수를 저장할 변수 추가

// --- 로그인 / 회원가입 ---
document.getElementById('btn-register').addEventListener('click', async () => {
    const id = document.getElementById('user-id').value.trim();
    const pw = document.getElementById('user-pw').value.trim();
    if(id.length < 2 || pw.length < 6) return alert("아이디 2자, 비밀번호 6자 이상 입력!");
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, id + "@pokemon.com", pw);
        await set(ref(db, 'users/' + userCredential.user.uid), { discordId: id, coin: 0, role: "user" });
        alert("가입 성공!");
    } catch (e) { alert("오류: 중복된 아이디거나 가입 실패입니다."); }
});

document.getElementById('btn-login').addEventListener('click', async () => {
    const id = document.getElementById('user-id').value.trim();
    const pw = document.getElementById('user-pw').value.trim();
    try { await signInWithEmailAndPassword(auth, id + "@pokemon.com", pw); } catch (e) { alert("아이디/비밀번호 오류!"); }
});

function resetTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => { alert("5분 미접속 자동 로그아웃"); signOut(auth); }, 300000);
}
window.addEventListener('mousemove', resetTimer); window.addEventListener('keydown', resetTimer);

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user; loginScreen.style.display = 'none'; gameScreen.style.display = 'flex'; resetTimer();
        onValue(ref(db, 'users/' + user.uid), (snapshot) => {
            const data = snapshot.val();
            if(data) {
                currentDiscordId = data.discordId; currentCoin = data.coin; isAdmin = (data.role === "admin");
                document.getElementById('display-username').innerText = data.discordId + " 님";
                document.getElementById('display-coin').innerText = data.coin.toLocaleString();
                if (isAdmin) { adminPanel.style.display = 'block'; loadAdminData(); } else { adminPanel.style.display = 'none'; }
            }
        });
    } else {
        currentUser = null; loginScreen.style.display = 'flex'; gameScreen.style.display = 'none'; adminPanel.style.display = 'none';
    }
});

// --- 유저: 충전/환전 신청 ---
document.getElementById('btn-req-charge').addEventListener('click', async () => {
    const amount = prompt("충전 신청할 코인 수량을 숫자로만 입력하세요:");
    if (!amount || isNaN(amount) || Number(amount) <= 0) return alert("올바른 수량을 입력해주세요!");
    await push(ref(db, 'requests/charge'), { uid: currentUser.uid, discordId: currentDiscordId, amount: Number(amount) });
    alert("✅ 충전 신청이 성공적으로 접수되었습니다!");
});
document.getElementById('btn-req-exchange').addEventListener('click', async () => {
    const amount = prompt("환전 신청할 코인 수량을 숫자로만 입력하세요:");
    if (!amount || isNaN(amount) || Number(amount) <= 0) return alert("올바른 수량을 입력해주세요!");
    if (Number(amount) > currentCoin) return alert("❌ 현재 보유하신 포켓코인보다 큰 금액은 환전할 수 없습니다!");
    await push(ref(db, 'requests/exchange'), { uid: currentUser.uid, discordId: currentDiscordId, amount: Number(amount) });
    alert("✅ 환전 신청이 성공적으로 접수되었습니다!");
});

// --- 홍보 배너 및 텍스트 실시간 동기화 ---
onValue(ref(db, 'settings/bannerUrl'), (snapshot) => {
    const url = snapshot.val();
    if (url) document.getElementById('banner-img').src = url; 
});

onValue(ref(db, 'settings/promoTexts'), (snapshot) => {
    const listDivUser = document.getElementById('promo-list');
    const listDivAdmin = document.getElementById('admin-promo-list');
    if(listDivUser) listDivUser.innerHTML = '';
    if(listDivAdmin) listDivAdmin.innerHTML = '';

    if (snapshot.exists()) {
        snapshot.forEach((child) => {
            const key = child.key; const text = child.val();
            if(listDivUser) {
                listDivUser.innerHTML += `<div style="background-color: #FFF3BF; padding: 12px; border-radius: 12px; font-size: 15px; color: #E67700; word-break: break-all; border: 2px dashed #FFD43B;">📢 ${text}</div>`;
            }
            if(listDivAdmin) {
                listDivAdmin.innerHTML += `
                <div class="req-item" style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${text}</span>
                    <button class="btn btn-exchange" style="padding: 3px 8px; font-size: 12px; margin-left: 5px;" onclick="window.removePromo('${key}')">삭제</button>
                </div>`;
            }
        });
    } else {
        if(listDivAdmin) listDivAdmin.innerHTML = '<span style="color: #ADB5BD; font-size: 14px;">등록된 홍보가 없습니다.</span>';
    }
});

window.removePromo = async (key) => { await remove(ref(db, 'settings/promoTexts/' + key)); };

// --- 관리자 전용 데이터 로드 ---
function loadAdminData() {
    document.getElementById('btn-admin-banner').onclick = async () => {
        const newUrl = document.getElementById('admin-banner-url').value.trim();
        if (!newUrl) return alert("이미지 주소(URL)를 입력해주세요!");
        await set(ref(db, 'settings/bannerUrl'), newUrl);
        alert("배너 이미지가 변경되었습니다!"); document.getElementById('admin-banner-url').value = '';
    };

    document.getElementById('btn-admin-promo').onclick = async () => {
        const text = document.getElementById('admin-promo-text').value.trim();
        if (!text) return alert("추가할 홍보 텍스트를 입력해주세요!");
        await push(ref(db, 'settings/promoTexts'), text);
        document.getElementById('admin-promo-text').value = '';
    };

    document.getElementById('btn-admin-give').onclick = async () => {
        const targetId = document.getElementById('admin-target-id').value.trim();
        const amount = Number(document.getElementById('admin-give-coin').value);
        if (!targetId || !amount) return alert("아이디와 코인 수량을 입력해주세요!");
        
        try {
            const q = query(ref(db, 'users'), orderByChild('discordId'), equalTo(targetId));
            const snapshot = await get(q);
            if (snapshot.exists()) {
                snapshot.forEach((child) => {
                    update(ref(db, 'users/' + child.key), { coin: child.val().coin + amount });
                    alert(`✅ [${targetId}]님에게 ${amount.toLocaleString()} 포켓코인 지급 완료!`);
                });
                document.getElementById('admin-target-id').value = ''; document.getElementById('admin-give-coin').value = '';
            } else { alert(`❌ "${targetId}" 유저를 찾을 수 없습니다.`); }
        } catch(e) { alert("지급 중 오류 발생: " + e.message); }
    };

    onValue(ref(db, 'requests/charge'), (snapshot) => {
        const listDiv = document.getElementById('charge-list'); listDiv.innerHTML = '';
        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const reqId = child.key; const data = child.val();
                listDiv.innerHTML += `<div class="req-item"><span>[${data.discordId}] <b>${data.amount.toLocaleString()}</b> 신청</span>
                    <button class="btn btn-charge" style="padding: 5px 10px; font-size: 14px;" onclick="window.approveCharge('${reqId}', '${data.uid}', ${data.amount})">승인</button></div>`;
            });
        } else { listDiv.innerHTML = '<span style="color: #ADB5BD; font-size: 14px;">대기중인 신청 없음</span>'; }
    });

    onValue(ref(db, 'requests/exchange'), (snapshot) => {
        const listDiv = document.getElementById('exchange-list'); listDiv.innerHTML = '';
        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const reqId = child.key; const data = child.val();
                listDiv.innerHTML += `<div class="req-item"><span>[${data.discordId}] <b>${data.amount.toLocaleString()}</b> 신청</span>
                    <button class="btn btn-exchange" style="padding: 5px 10px; font-size: 14px;" onclick="window.approveExchange('${reqId}', '${data.uid}', ${data.amount})">승인</button></div>`;
            });
        } else { listDiv.innerHTML = '<span style="color: #ADB5BD; font-size: 14px;">대기중인 신청 없음</span>'; }
    });
}

window.approveCharge = async (reqId, uid, amount) => {
    const userRef = ref(db, 'users/' + uid); const snap = await get(userRef);
    if (snap.exists()) { await update(userRef, { coin: snap.val().coin + amount }); await remove(ref(db, 'requests/charge/' + reqId)); }
};
window.approveExchange = async (reqId, uid, amount) => {
    const userRef = ref(db, 'users/' + uid); const snap = await get(userRef);
    if (snap.exists()) {
        if (snap.val().coin >= amount) { await update(userRef, { coin: snap.val().coin - amount }); await remove(ref(db, 'requests/exchange/' + reqId)); } 
        else { alert("유저의 코인이 부족합니다!"); }
    }
};

// ----------------------------------------------------
// [핵심] 🎮 배팅 시스템 (수동 캐시아웃 장착)
// ----------------------------------------------------

btnBetting.addEventListener('click', async () => {
    if (!currentUser) return alert("로그인 후 이용 가능합니다.");
    if (myBetState === 'cashed_out') return; // 이미 먹튀에 성공했다면 아무 동작 안함

    // ⭐ 1. 수동 캐시아웃 (게임 진행 중이고, 내가 아직 비행 중일 때 클릭)
    if (myBetState === 'playing' && currentGameStatus === 'running') {
        myBetState = 'cashed_out'; // 상태 변경
        const winAmount = Math.floor(myBetAmount * currentLiveMultiplier); // 현재 배수만큼 코인 계산
        
        await update(ref(db, 'users/' + currentUser.uid), { coin: currentCoin + winAmount }); // 지갑에 지급
        
        // 버튼 텍스트를 축하 문구로 변경
        btnBetting.innerText = `🎉 ${currentLiveMultiplier.toFixed(2)}x 성공! +${winAmount.toLocaleString()}`;
        btnBetting.style.backgroundColor = "#E64980";
        btnBetting.style.color = "white";
        btnBetting.style.fontSize = "18px";
        return;
    }

    // ⭐ 2. 대기열 예약 취소
    if (myBetState === 'queued') {
        await update(ref(db, 'users/' + currentUser.uid), { coin: currentCoin + myBetAmount });
        myBetState = 'none';
        btnBetting.innerText = "배팅하기";
        btnBetting.style.backgroundColor = "#FFD43B";
        btnBetting.style.color = "#333";
        btnBetting.style.fontSize = "24px"; 
        return;
    }

    // ⭐ 3. 새로운 배팅 등록
    myBetAmount = Number(document.getElementById('bet-amount').value);
    myAutoCashout = Number(document.getElementById('auto-cashout').value);

    if (myBetAmount <= 0 || myBetAmount > currentCoin) return alert("보유 코인이 부족하거나 올바른 금액이 아닙니다.");
    if (myBetAmount > 50000) return alert("최대 배팅 가능 금액은 50,000 코인입니다!");
    if (myAutoCashout < 1.01) return alert("캐시아웃 배수는 1.01 이상이어야 합니다.");

    await update(ref(db, 'users/' + currentUser.uid), { coin: currentCoin - myBetAmount });
    myBetState = 'queued';

    btnBetting.style.backgroundColor = "#FA5252";
    btnBetting.style.color = "white";
    btnBetting.style.fontSize = "18px"; 

    if (currentGameStatus === 'waiting') {
        btnBetting.innerText = "❌ 취소 (이번 판)";
    } else {
        btnBetting.innerText = "❌ 취소 (다음 판)";
    }
});

// --- 게임 상태 감지 로직 ---
onValue(ref(db, 'game'), (snapshot) => {
    const game = snapshot.val();
    if (!game) return;
    
    const previousStatus = currentGameStatus;
    currentGameStatus = game.status;

    if (game.status === 'waiting') {
        if (myBetState === 'queued') {
            btnBetting.innerText = "❌ 취소 (이번 판)";
            btnBetting.style.backgroundColor = "#FA5252";
            btnBetting.style.color = "white";
            btnBetting.style.fontSize = "18px";
        } else if (myBetState === 'none') {
            btnBetting.innerText = "배팅하기";
            btnBetting.style.backgroundColor = "#FFD43B";
            btnBetting.style.color = "#333";
            btnBetting.style.fontSize = "24px";
        }
        startCountdownVisuals(game.nextStartTime);

    } else if (game.status === 'running') {
        if (previousStatus === 'waiting' && myBetState === 'queued') {
            myBetState = 'playing';
            // 버튼 디자인은 startGameVisuals 내부에서 실시간으로 캐시아웃 유도로 바뀝니다!
        }
        startGameVisuals(game.startTime, game.crashPoint);

    } else if (game.status === 'crashed') {
        if (myBetState === 'playing' || myBetState === 'cashed_out') {
            myBetState = 'none';
        }
        stopGameVisuals(game.crashPoint);
    }
});

function startCountdownVisuals(nextStartTime) {
    cancelAnimationFrame(gameAnimationId); cancelAnimationFrame(countdownAnimationId);
    bustedMsg.style.display = 'none'; countdownMsg.style.display = 'block'; 
    multiplierDisplay.innerText = "1.00x"; multiplierDisplay.style.color = "#ADB5BD"; 
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); 

    const drawCountdown = () => {
        const remainMs = nextStartTime - Date.now();
        if (remainMs <= 0) { countdownSec.innerText = "0.0"; return; }
        countdownSec.innerText = (remainMs / 1000).toFixed(1); 
        countdownAnimationId = requestAnimationFrame(drawCountdown);
    };
    drawCountdown();
}

function startGameVisuals(startTime, crashPoint) {
    cancelAnimationFrame(gameAnimationId); cancelAnimationFrame(countdownAnimationId);
    countdownMsg.style.display = 'none'; bustedMsg.style.display = 'none';
    canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
    const ctx = canvas.getContext('2d');

    const draw = () => {
        let elapsed = (Date.now() - startTime) / 1000;
        let currentMulti = 1.00 + (elapsed * 0.4); 
        if (currentMulti >= crashPoint) currentMulti = crashPoint;

        currentLiveMultiplier = currentMulti; // 전역 변수에 실시간 배수 저장

        multiplierDisplay.innerText = currentMulti.toFixed(2) + "x";
        multiplierDisplay.style.color = "#40C057";

        // ⭐ 비행 중이고 아직 이득을 안 챙긴 상태일 때 버튼 디자인 업데이트
        if (myBetState === 'playing') {
            if (currentMulti >= myAutoCashout) {
                // 설정해둔 자동 배수에 먼저 도달했을 때
                myBetState = 'cashed_out';
                const winAmount = Math.floor(myBetAmount * myAutoCashout);
                update(ref(db, 'users/' + currentUser.uid), { coin: currentCoin + winAmount });
                
                btnBetting.innerText = `🎉 자동성공! +${winAmount.toLocaleString()}`;
                btnBetting.style.backgroundColor = "#E64980"; 
                btnBetting.style.color = "white";
                btnBetting.style.fontSize = "18px";
            } else {
                // 아직 날아가고 있다면 실시간 수동 캐시아웃 유도 텍스트 보여주기
                const currentProfit = Math.floor(myBetAmount * currentMulti);
                btnBetting.innerText = `💰 수동 캐시아웃 (+${currentProfit.toLocaleString()})`;
                btnBetting.style.backgroundColor = "#20C997"; // 초록빛의 먹튀 유도 색상
                btnBetting.style.color = "white";
                btnBetting.style.fontSize = "18px";
            }
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath(); ctx.moveTo(0, canvas.height);
        let progress = Math.min((currentMulti - 1) / 3, 1);
        let currentX = canvas.width * progress; let currentY = canvas.height - (canvas.height * progress);
        ctx.lineTo(currentX, currentY); ctx.strokeStyle = "#FFD43B"; ctx.lineWidth = 6; ctx.stroke();

        if (currentMulti < crashPoint) gameAnimationId = requestAnimationFrame(draw);
    };
    draw();
}

function stopGameVisuals(crashPoint) {
    cancelAnimationFrame(gameAnimationId); cancelAnimationFrame(countdownAnimationId);
    countdownMsg.style.display = 'none';
    multiplierDisplay.innerText = crashPoint.toFixed(2) + "x";
    multiplierDisplay.style.color = "#FA5252";
    bustedMsg.style.display = 'block';
    const ctx = canvas.getContext('2d'); ctx.strokeStyle = "#FA5252"; ctx.stroke();
}

onValue(query(ref(db, 'history'), limitToLast(10)), (snapshot) => {
    const listDiv = document.getElementById('history-list');
    listDiv.innerHTML = '';
    if (snapshot.exists()) {
        const historyArray = [];
        snapshot.forEach((child) => { historyArray.push(child.val().crashPoint); });
        
        historyArray.forEach(pt => {
            const isWin = pt >= 2.00;
            const className = isWin ? 'history-item win' : 'history-item lose';
            listDiv.innerHTML += `<span class="${className}">${pt.toFixed(2)}x</span>`;
        });
    } else {
        listDiv.innerHTML = '<span style="color: #ADB5BD; font-size: 14px;">기록 없음</span>';
    }
});