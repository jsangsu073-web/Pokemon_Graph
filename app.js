import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, get, update, push, remove, query, orderByChild, equalTo, limitToLast, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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

let serverTimeOffset = 0;
onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    serverTimeOffset = snap.val() || 0;
});

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
let isAdmin = false; let isAdminLoaded = false; 
let inactivityTimer;
let gameAnimationId; let countdownAnimationId;

let currentGameStatus = 'offline';
let myBetState = 'none'; 
let myBetAmount = 0;
let myAutoCashout = 0;
let currentLiveMultiplier = 1.00; 
let currentCrashPoint = 1.00; 
let localGameStartTime = 0; 

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
                if (isAdmin) { 
                    adminPanel.style.display = 'block'; 
                    if (!isAdminLoaded) {
                        loadAdminData();
                        isAdminLoaded = true;
                    }
                } else { 
                    adminPanel.style.display = 'none'; 
                }
            }
        });
    } else {
        currentUser = null; loginScreen.style.display = 'flex'; gameScreen.style.display = 'none'; adminPanel.style.display = 'none';
        isAdminLoaded = false; 
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

// --- 홍보 배너 관리 ---
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
            if(listDivUser) listDivUser.innerHTML += `<div style="background-color: #FFF3BF; padding: 12px; border-radius: 12px; font-size: 15px; color: #E67700; word-break: break-all; border: 2px dashed #FFD43B;">📢 ${text}</div>`;
            if(listDivAdmin) listDivAdmin.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 5px;">
                    <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color: white;">${text}</span>
                    <button style="background: #FA5252; color: white; border: none; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin-left: 5px;" onclick="window.removePromo('${key}')">삭제</button>
                </div>`;
        });
    } else {
        if(listDivAdmin) listDivAdmin.innerHTML = '<span style="color: #ADB5BD; font-size: 14px;">등록된 홍보가 없습니다.</span>';
    }
});

function loadAdminData() {
    
    // ⭐ 유저 잔액 조회 및 수정, 초기화 기능
    const queryIdInput = document.getElementById('admin-query-id');
    const btnQuery = document.getElementById('btn-admin-query');
    const resultDiv = document.getElementById('admin-query-result');
    const resultId = document.getElementById('query-result-id');
    const resultCoin = document.getElementById('query-result-coin');
    const modifyInput = document.getElementById('admin-modify-coin');
    const btnModify = document.getElementById('btn-admin-modify');
    const btnReset = document.getElementById('btn-admin-reset');
    const hiddenUid = document.getElementById('query-result-uid');

    if (btnQuery) {
        btnQuery.onclick = async () => {
            const targetId = queryIdInput.value.trim();
            if (!targetId) return alert("조회할 아이디를 입력해주세요.");
            
            const q = query(ref(db, 'users'), orderByChild('discordId'), equalTo(targetId));
            const snapshot = await get(q);
            if (snapshot.exists()) {
                snapshot.forEach((child) => {
                    const userData = child.val();
                    resultId.innerText = userData.discordId;
                    resultCoin.innerText = userData.coin.toLocaleString();
                    hiddenUid.value = child.key;
                    modifyInput.value = userData.coin; 
                    resultDiv.style.display = 'block';
                });
            } else {
                alert(`❌ "${targetId}" 유저를 찾을 수 없습니다.`);
                resultDiv.style.display = 'none';
            }
        };
    }

    if (btnModify) {
        btnModify.onclick = async () => {
            const uid = hiddenUid.value;
            const newCoin = Number(modifyInput.value);
            
            if (!uid) return alert("먼저 유저를 조회해주세요.");
            if (isNaN(newCoin) || newCoin < 0) return alert("올바른 숫자를 입력해주세요.");

            if (confirm(`정말 [${resultId.innerText}]님의 잔액을 ${newCoin.toLocaleString()} 코인으로 완전히 덮어씌우시겠습니까?`)) {
                await update(ref(db, 'users/' + uid), { coin: newCoin });
                alert("✅ 잔액이 성공적으로 수정되었습니다!");
                resultCoin.innerText = newCoin.toLocaleString(); 
            }
        };
    }

    if (btnReset) {
        btnReset.onclick = () => {
            queryIdInput.value = '';        
            resultDiv.style.display = 'none'; 
        };
    }

    // 기존 배너 등록 기능
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

    // 충전 요청
    onValue(ref(db, 'requests/charge'), (snapshot) => {
        const listDiv = document.getElementById('charge-list'); listDiv.innerHTML = '';
        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const reqId = child.key; const data = child.val();
                listDiv.innerHTML += `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: white;">
                        <span>[${data.discordId}] <b>${data.amount.toLocaleString()}</b> 신청</span>
                        <div style="display: flex; gap: 5px;">
                            <button style="background: #20C997; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 13px;" onclick="window.approveCharge('${reqId}', '${data.uid}', ${data.amount})">승인</button>
                            <button style="background: #FA5252; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 13px;" onclick="window.deleteRequest('charge', '${reqId}')">삭제</button>
                        </div>
                    </div>`;
            });
        } else { listDiv.innerHTML = '<span style="color: #ADB5BD; font-size: 14px;">대기중인 신청 없음</span>'; }
    });

    // 환전 요청
    onValue(ref(db, 'requests/exchange'), (snapshot) => {
        const listDiv = document.getElementById('exchange-list'); listDiv.innerHTML = '';
        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const reqId = child.key; const data = child.val();
                listDiv.innerHTML += `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: white;">
                        <span>[${data.discordId}] <b>${data.amount.toLocaleString()}</b> 신청</span>
                        <div style="display: flex; gap: 5px;">
                            <button style="background: #E64980; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 13px;" onclick="window.approveExchange('${reqId}', '${data.uid}', ${data.amount})">승인</button>
                            <button style="background: #FA5252; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 13px;" onclick="window.deleteRequest('exchange', '${reqId}')">삭제</button>
                        </div>
                    </div>`;
            });
        } else { listDiv.innerHTML = '<span style="color: #ADB5BD; font-size: 14px;">대기중인 신청 없음</span>'; }
    });

    // 배팅 로그
    onValue(query(ref(db, 'betLogs'), limitToLast(30)), (snapshot) => {
        const listDiv = document.getElementById('bet-log-list');
        if (!listDiv) return;
        listDiv.innerHTML = '';
        if (snapshot.exists()) {
            const logs = [];
            snapshot.forEach((child) => { logs.push(child.val()); });
            logs.reverse().forEach(log => {
                
                const resultText = log.result || '알수없음';
                const isWin = resultText === '성공';
                const isDelayed = resultText.includes('지연'); 
                
                const color = isWin ? '#2B8A3E' : (isDelayed ? '#E67700' : '#C92A2A');
                const bg = isWin ? '#D3F9D8' : (isDelayed ? '#FFF3BF' : '#FFE3E3');
                
                let multiText = '';
                if (isWin) multiText = `${log.multiplier}x 획득`;
                else if (isDelayed) multiText = `버튼 눌림 (${log.multiplier}x)`;
                else multiText = `💥 증발`;

                const timeText = log.time ? log.time : (log.timestamp ? new Date(log.timestamp).toLocaleString('ko-KR') : '시간 기록 없음');

                listDiv.innerHTML += `
                    <div style="background-color: ${bg}; color: ${color}; padding: 10px; margin-bottom: 5px; border-radius: 8px;">
                        <div style="font-size: 11px; color: #868E96; margin-bottom: 4px;">${timeText}</div>
                        <span>[${log.discordId || '알수없음'}] <b>${(log.betAmount || 0).toLocaleString()}</b>코인 ➔ <b>${multiText}</b></span>
                    </div>`;
            });
        } else { 
            listDiv.innerHTML = '<span style="color: #ADB5BD; font-size: 14px;">기록 없음</span>'; 
        }
    });

    const btnExportLogs = document.getElementById('btn-export-logs');
    if (btnExportLogs) {
        btnExportLogs.onclick = async () => {
            try {
                const snapshot = await get(ref(db, 'betLogs'));
                if (!snapshot.exists()) return alert("다운로드할 데이터가 없습니다.");
                let csvContent = "\uFEFF날짜/시간,아이디,배팅금,결과,배당률\n";
                const logs = [];
                snapshot.forEach((child) => { logs.push(child.val()); });
                logs.reverse().forEach(log => {
                    const date = log.time || (log.timestamp ? new Date(log.timestamp).toLocaleString('ko-KR') : '시간없음');
                    csvContent += `"${date}","${log.discordId}",${log.betAmount || 0},"${log.result || '알수없음'}","${log.multiplier || 0}x"\n`;
                });
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `배팅로그_${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } catch (e) { alert("다운로드 중 오류 발생: " + e.message); }
        };
    }
}

window.approveCharge = async (reqId, uid, amount) => {
    const userRef = ref(db, 'users/' + uid); 
    await update(userRef, { coin: increment(amount) }); 
    await remove(ref(db, 'requests/charge/' + reqId)); 
};
window.approveExchange = async (reqId, uid, amount) => {
    const userRef = ref(db, 'users/' + uid); const snap = await get(userRef);
    if (snap.exists()) {
        if (snap.val().coin >= amount) { 
            await update(userRef, { coin: increment(-amount) }); 
            await remove(ref(db, 'requests/exchange/' + reqId)); 
        } 
        else { alert("유저의 코인이 부족합니다!"); }
    }
};
window.deleteRequest = async (type, reqId) => {
    if (confirm("정말 이 신청 내역을 삭제하시겠습니까?\n(유저의 코인은 변동되지 않으며 내역만 지워집니다.)")) { await remove(ref(db, 'requests/' + type + '/' + reqId)); }
};
window.removePromo = async (key) => { await remove(ref(db, 'settings/promoTexts/' + key)); };

// ----------------------------------------------------
// [핵심] 🎮 배팅 시스템
// ----------------------------------------------------
btnBetting.addEventListener('click', () => {
    if (!currentUser) return alert("로그인 후 이용 가능합니다.");
    if (myBetState === 'cashed_out') return; 

    if (myBetState === 'playing' && currentGameStatus === 'running') {
        const koreanTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        if (currentLiveMultiplier >= currentCrashPoint) { 
            push(ref(db, 'betLogs'), { 
                discordId: currentDiscordId, 
                betAmount: myBetAmount, 
                result: '캐시아웃 지연(밀림)', 
                multiplier: currentLiveMultiplier.toFixed(2), 
                time: koreanTimeStr 
            });
            return; 
        }

        myBetState = 'cashed_out';
        const winAmount = Math.floor(myBetAmount * currentLiveMultiplier); 
        
        btnBetting.innerText = `🎉 수동 성공! +${winAmount.toLocaleString()}`;
        btnBetting.style.backgroundColor = "#E64980";
        btnBetting.style.color = "white";
        btnBetting.style.fontSize = "18px";

        update(ref(db, 'users/' + currentUser.uid), { coin: increment(winAmount) });
        
        push(ref(db, 'betLogs'), { 
            discordId: currentDiscordId, 
            betAmount: myBetAmount, 
            result: '성공', 
            multiplier: currentLiveMultiplier.toFixed(2), 
            time: koreanTimeStr 
        });
        return;
    }

    if (myBetState === 'queued') {
        myBetState = 'none';
        
        btnBetting.innerText = "배팅하기";
        btnBetting.style.backgroundColor = "#FFD43B";
        btnBetting.style.color = "#333";
        btnBetting.style.fontSize = "24px"; 
        
        update(ref(db, 'users/' + currentUser.uid), { coin: increment(myBetAmount) });
        return;
    }

    myBetAmount = Number(document.getElementById('bet-amount').value);
    myAutoCashout = Number(document.getElementById('auto-cashout').value);

    if (myBetAmount <= 0 || myBetAmount > currentCoin) return alert("보유 코인이 부족하거나 올바른 금액이 아닙니다.");
    if (myBetAmount > 50000) return alert("최대 배팅 가능 금액은 50,000 코인입니다!");
    if (myAutoCashout < 1.01) return alert("캐시아웃 배수는 1.01 이상이어야 합니다.");

    myBetState = 'queued';
    
    btnBetting.style.backgroundColor = "#FA5252";
    btnBetting.style.color = "white";
    btnBetting.style.fontSize = "18px"; 
    btnBetting.innerText = (currentGameStatus === 'waiting') ? "❌ 예약 취소" : "✅ 다음게임 예약 (다시 누르면 취소)";

    update(ref(db, 'users/' + currentUser.uid), { coin: increment(-myBetAmount) });
});

onValue(ref(db, 'game'), (snapshot) => {
    const game = snapshot.val();
    if (!game) return;
    
    const previousStatus = currentGameStatus;
    currentGameStatus = game.status;

    if (game.status === 'waiting') {
        if (myBetState === 'queued') {
            btnBetting.innerText = "❌ 예약 취소";
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
        currentCrashPoint = game.crashPoint; 

        if (previousStatus === 'waiting' && myBetState === 'queued') myBetState = 'playing';
        
        if (previousStatus !== 'running') {
            if (previousStatus === 'waiting') {
                localGameStartTime = Date.now(); 
            } else {
                let passedTime = (Date.now() + serverTimeOffset) - game.startTime;
                localGameStartTime = Date.now() - passedTime;
            }
            startGameVisuals(game.crashPoint);
        }

    } else if (game.status === 'crashed') {
        let wasCashedOut = (myBetState === 'cashed_out'); 

        if (myBetState === 'playing') {
            if (myAutoCashout > 1.00 && game.crashPoint >= myAutoCashout) {
                const winAmount = Math.floor(myBetAmount * myAutoCashout);
                const koreanTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                
                update(ref(db, 'users/' + currentUser.uid), { coin: increment(winAmount) });
                push(ref(db, 'betLogs'), { discordId: currentDiscordId, betAmount: myBetAmount, result: '성공', multiplier: myAutoCashout.toFixed(2), time: koreanTimeStr });
                
                btnBetting.innerText = `🎉 자동성공 (구제)! +${winAmount.toLocaleString()}`;
                btnBetting.style.backgroundColor = "#E64980"; 
                btnBetting.style.color = "white";
                btnBetting.style.fontSize = "18px";
                
                wasCashedOut = true;
            } else {
                const koreanTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                push(ref(db, 'betLogs'), { 
                    discordId: currentDiscordId, 
                    betAmount: myBetAmount, 
                    result: '실패', 
                    multiplier: 0, 
                    time: koreanTimeStr 
                });
            }
            myBetState = 'none';
        } else if (myBetState === 'cashed_out') {
            myBetState = 'none';
        }

        if (myBetState === 'none' && !wasCashedOut) {
            btnBetting.innerText = "배팅하기";
            btnBetting.style.backgroundColor = "#FFD43B";
            btnBetting.style.color = "#333";
            btnBetting.style.fontSize = "24px";
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

function startGameVisuals(crashPoint) {
    cancelAnimationFrame(gameAnimationId); cancelAnimationFrame(countdownAnimationId);
    countdownMsg.style.display = 'none'; bustedMsg.style.display = 'none';
    canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
    const ctx = canvas.getContext('2d');

    const draw = () => {
        let elapsed = Math.max(0, (Date.now() - localGameStartTime) / 1000); 

        let currentMulti = 1.00 + (elapsed * 0.4); 
        
        let isBustedLocally = false; 
        if (currentMulti >= crashPoint) {
            currentMulti = crashPoint;
            isBustedLocally = true; 
        }

        currentLiveMultiplier = currentMulti; 

        multiplierDisplay.innerText = currentMulti.toFixed(2) + "x";
        multiplierDisplay.style.color = "#40C057";

        if (myBetState === 'playing') {
            if (isBustedLocally) {
                // 대기
            } else if (currentMulti >= myAutoCashout) {
                myBetState = 'cashed_out';
                const winAmount = Math.floor(myBetAmount * myAutoCashout);
                
                btnBetting.innerText = `🎉 자동성공! +${winAmount.toLocaleString()}`;
                btnBetting.style.backgroundColor = "#E64980"; 
                btnBetting.style.color = "white";
                btnBetting.style.fontSize = "18px";

                update(ref(db, 'users/' + currentUser.uid), { coin: increment(winAmount) });
                
                const koreanTimeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                push(ref(db, 'betLogs'), { discordId: currentDiscordId, betAmount: myBetAmount, result: '성공', multiplier: myAutoCashout.toFixed(2), time: koreanTimeStr });
            } else {
                const currentProfit = Math.floor(myBetAmount * currentMulti);
                btnBetting.innerText = `💰 수동 캐시아웃 (+${currentProfit.toLocaleString()})`;
                btnBetting.style.backgroundColor = "#20C997"; 
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
        
        historyArray.reverse().forEach(pt => {
            const isWin = pt >= 1.50;
            const className = isWin ? 'history-item win' : 'history-item lose';
            listDiv.innerHTML += `<span class="${className}">${pt.toFixed(2)}x</span>`;
        });
    } else {
        listDiv.innerHTML = '<span style="color: #ADB5BD; font-size: 14px;">기록 없음</span>';
    }
});
