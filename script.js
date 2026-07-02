"use strict";

const canvas = document.getElementById("gameCanvas");
const context = canvas.getContext("2d");
const scoreElement = document.getElementById("score");
const bestScoreElement = document.getElementById("bestScore");
const finalScoreElement = document.getElementById("finalScore");
const lastCollectibleElement = document.getElementById("lastCollectible");
const lastPointsElement = document.getElementById("lastPoints");
const gameOverElement = document.getElementById("gameOver");
const leaderboardList = document.getElementById("leaderboardList");
const restartButton = document.getElementById("restartButton");
const overlayRestartButton = document.getElementById("overlayRestartButton");
const recordModal = document.getElementById("recordModal");
const recordForm = document.getElementById("recordForm");
const playerNameInput = document.getElementById("playerName");
const recordSubmitButton = document.getElementById("recordSubmitButton");
const leaderboardStatusElement = document.getElementById("leaderboardStatus");
const dpadButtons = document.querySelectorAll(".dpad-button");

const gridSize = 20;
const logicalCanvasSize = 600;
const cellSize = logicalCanvasSize / gridSize;
const tickRate = 110;
const leaderboardWriteTimeout = 8000;

const firebaseConfig = {
  apiKey: "AIzaSyC8fMhl3rLU_TJHkQn-tj2o0FBAYz8n4kg",
  authDomain: "snake-luigi.firebaseapp.com",
  projectId: "snake-luigi",
  storageBucket: "snake-luigi.firebasestorage.app",
  messagingSenderId: "300518886492",
  appId: "1:300518886492:web:73913c5c607e1816316a9"
};

const firebaseSdkUrls = {
  app: "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js",
  auth: "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js",
  firestore: "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js"
};

const collectibleTypes = {
  mushroom: { label: "Червена гъбка", points: 10 },
  star: { label: "Златна звезда", points: 25 }
};

const directionByKey = {
  ArrowUp: { x: 0, y: -1 },
  w: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  a: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  d: { x: 1, y: 0 }
};

const directionByName = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const swipeThreshold = 28;

let snake;
let collectible;
let direction;
let nextDirection;
let score;
let gameLoop;
let isGameOver;
let turnLocked;
let topScores = [];
let pendingScore = null;
let animationFrame = null;
let swipeStart = null;
let firebaseInitializationPromise = null;
let firebaseUser = null;
let leaderboardCollection = null;
let firebaseApi = null;
let leaderboardReady = false;
let scoreSubmissionInProgress = false;

function initializeOnlineLeaderboard() {
  if (!firebaseInitializationPromise) {
    firebaseInitializationPromise = connectToFirebase();
  }

  return firebaseInitializationPromise;
}

async function connectToFirebase() {
  setLeaderboardStatus("Класацията се зарежда…");

  try {
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import(firebaseSdkUrls.app),
      import(firebaseSdkUrls.auth),
      import(firebaseSdkUrls.firestore)
    ]);

    const { initializeApp } = appModule;
    const { getAuth, signInAnonymously } = authModule;
    const {
      getFirestore,
      collection,
      addDoc,
      serverTimestamp,
      query,
      orderBy,
      limit,
      onSnapshot
    } = firestoreModule;

    const firebaseApp = initializeApp(firebaseConfig);
    const auth = getAuth(firebaseApp);
    const database = getFirestore(firebaseApp);
    const credentials = await signInAnonymously(auth);

    firebaseUser = credentials.user;
    leaderboardCollection = collection(database, "leaderboard");
    firebaseApi = { addDoc, serverTimestamp };

    const leaderboardQuery = query(
      leaderboardCollection,
      orderBy("score", "desc"),
      limit(3)
    );

    onSnapshot(
      leaderboardQuery,
      snapshot => {
        topScores = snapshot.docs
          .map(documentSnapshot => ({
            id: documentSnapshot.id,
            ...documentSnapshot.data()
          }))
          .filter(entry => typeof entry.name === "string" && Number.isInteger(entry.score))
          .map(entry => ({
            id: entry.id,
            name: entry.name.trim().slice(0, 12) || "Luigi",
            score: Math.max(0, entry.score)
          }));

        leaderboardReady = true;
        renderLeaderboard();
        updateBestScore();
        setLeaderboardStatus("");
      },
      () => {
        leaderboardReady = false;
        setLeaderboardStatus("Онлайн класацията временно не е налична", true);
      }
    );
  } catch {
    leaderboardReady = false;
    setLeaderboardStatus("Онлайн класацията временно не е налична", true);
  }
}

function setLeaderboardStatus(message, isUnavailable = false) {
  leaderboardStatusElement.textContent = message;
  leaderboardStatusElement.hidden = message === "";
  leaderboardStatusElement.classList.toggle("is-unavailable", isUnavailable);
}

function configureCanvas() {
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const cssSize = canvas.getBoundingClientRect().width || logicalCanvasSize;
  const backingSize = Math.round(cssSize * pixelRatio);
  const coordinateScale = backingSize / logicalCanvasSize;

  if (canvas.width !== backingSize || canvas.height !== backingSize) {
    canvas.width = backingSize;
    canvas.height = backingSize;
  }

  context.setTransform(coordinateScale, 0, 0, coordinateScale, 0, 0);
  context.imageSmoothingEnabled = true;
}

function startGame() {
  clearInterval(gameLoop);

  snake = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 }
  ];
  direction = { x: 1, y: 0 };
  nextDirection = { ...direction };
  score = 0;
  isGameOver = false;
  turnLocked = false;
  pendingScore = null;
  collectible = createCollectible();

  scoreElement.textContent = score;
  updateBestScore();
  lastCollectibleElement.textContent = "—";
  lastPointsElement.textContent = "Събери гъбка или звезда";
  gameOverElement.classList.remove("is-visible");
  gameOverElement.setAttribute("aria-hidden", "true");
  hideRecordModal();

  gameLoop = setInterval(update, tickRate);

  if (animationFrame === null) {
    animationFrame = requestAnimationFrame(renderFrame);
  }
}

function createCollectible() {
  const freeCells = [];

  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const isOccupied = snake.some(segment => segment.x === x && segment.y === y);
      if (!isOccupied) freeCells.push({ x, y });
    }
  }

  if (freeCells.length === 0) return null;

  const position = freeCells[Math.floor(Math.random() * freeCells.length)];
  const type = Math.random() < 0.65 ? "mushroom" : "star";
  return { ...position, type, ...collectibleTypes[type] };
}

function update() {
  direction = nextDirection;
  turnLocked = false;

  const head = {
    x: (snake[0].x + direction.x + gridSize) % gridSize,
    y: (snake[0].y + direction.y + gridSize) % gridSize
  };
  const willCollect = collectible && head.x === collectible.x && head.y === collectible.y;
  const bodyToCheck = willCollect ? snake : snake.slice(0, -1);
  const hitsBody = bodyToCheck.some(segment => segment.x === head.x && segment.y === head.y);

  if (hitsBody) {
    endGame();
    return;
  }

  snake.unshift(head);

  if (willCollect) {
    score += collectible.points;
    scoreElement.textContent = score;
    lastCollectibleElement.textContent = collectible.label;
    lastPointsElement.textContent = `+${collectible.points} точки`;
    updateBestScore();
    collectible = createCollectible();
  } else {
    snake.pop();
  }
}

function renderFrame(timestamp) {
  draw(timestamp);
  animationFrame = requestAnimationFrame(renderFrame);
}

function draw(timestamp = 0) {
  drawBoard();

  if (collectible) {
    if (collectible.type === "mushroom") {
      drawMushroom(collectible.x, collectible.y, timestamp);
    } else {
      drawStar(collectible.x, collectible.y, timestamp);
    }
  }

  snake.forEach((segment, index) => {
    const padding = index === 0 ? 2.5 : 3.5;
    const x = segment.x * cellSize + padding;
    const y = segment.y * cellSize + padding;
    const size = cellSize - padding * 2;

    context.fillStyle = index === 0 ? "#8af3cd" : `hsl(158 70% ${Math.max(42, 62 - index * 0.7)}%)`;
    roundRect(context, x, y, size, size, 5);
    context.fill();

    if (index === 0) drawEyes(segment);
  });
}

function drawBoard() {
  const gradient = context.createLinearGradient(0, 0, logicalCanvasSize, logicalCanvasSize);
  gradient.addColorStop(0, "#101824");
  gradient.addColorStop(1, "#080d15");
  context.fillStyle = gradient;
  context.fillRect(0, 0, logicalCanvasSize, logicalCanvasSize);

  context.strokeStyle = "rgba(103, 231, 184, 0.045)";
  context.lineWidth = 1;

  for (let i = 1; i < gridSize; i += 1) {
    const position = i * cellSize + 0.5;
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, logicalCanvasSize);
    context.stroke();
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(logicalCanvasSize, position);
    context.stroke();
  }
}

function drawMushroom(gridX, gridY, timestamp) {
  const centerX = gridX * cellSize + cellSize / 2;
  const centerY = gridY * cellSize + cellSize / 2;
  const bob = Math.sin(timestamp / 330) * cellSize * 0.025;
  const scale = 1 + Math.sin(timestamp / 430) * 0.012;

  context.save();
  context.translate(centerX, centerY + bob);
  context.scale(scale, scale);
  context.lineJoin = "round";
  context.lineCap = "round";

  const shadow = context.createRadialGradient(0, 9.7, 0.5, 0, 9.7, 9);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.38)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = shadow;
  context.beginPath();
  context.ellipse(0, 9.7, 9.6, 2.5, 0, 0, Math.PI * 2);
  context.fill();

  const stemGradient = context.createLinearGradient(-5, 2, 6, 8);
  stemGradient.addColorStop(0, "#fff5dc");
  stemGradient.addColorStop(0.58, "#e9cea4");
  stemGradient.addColorStop(1, "#b98a61");
  context.fillStyle = stemGradient;
  context.strokeStyle = "#321f25";
  context.lineWidth = 1.55;
  context.beginPath();
  context.moveTo(-5.1, 1.5);
  context.bezierCurveTo(-4.9, 4.3, -5.6, 7.1, -6.5, 8.1);
  context.quadraticCurveTo(0, 10.5, 6.5, 8.1);
  context.bezierCurveTo(5.5, 6.3, 5, 4.1, 5.1, 1.5);
  context.closePath();
  context.fill();
  context.stroke();

  const capGradient = context.createLinearGradient(0, -11.5, 0, 4.2);
  capGradient.addColorStop(0, "#ff6a67");
  capGradient.addColorStop(0.48, "#e63842");
  capGradient.addColorStop(1, "#991f31");
  context.fillStyle = capGradient;
  context.strokeStyle = "#321923";
  context.lineWidth = 1.7;
  context.beginPath();
  context.moveTo(-11.5, 2.8);
  context.bezierCurveTo(-11.1, -5.6, -6.3, -10.8, 0, -11.2);
  context.bezierCurveTo(6.4, -10.9, 11.1, -5.5, 11.5, 2.8);
  context.quadraticCurveTo(6.2, 5, 0, 4.3);
  context.quadraticCurveTo(-6.2, 5, -11.5, 2.8);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = "#fff8e9";
  context.strokeStyle = "rgba(92, 30, 38, 0.42)";
  context.lineWidth = 0.6;
  [
    { x: -5.7, y: -4.7, rx: 2.5, ry: 2.15, rotation: -0.25 },
    { x: 3.8, y: -6.4, rx: 2.35, ry: 2.7, rotation: 0.28 },
    { x: 7.6, y: 0.3, rx: 1.7, ry: 1.4, rotation: 0.15 }
  ].forEach(spot => {
    context.beginPath();
    context.ellipse(spot.x, spot.y, spot.rx, spot.ry, spot.rotation, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });

  const highlight = context.createRadialGradient(-4.6, -7.6, 0, -4.6, -7.6, 5.4);
  highlight.addColorStop(0, "rgba(255, 255, 255, 0.7)");
  highlight.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = highlight;
  context.beginPath();
  context.ellipse(-4.5, -7.2, 5.4, 2.3, -0.3, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawStar(gridX, gridY, timestamp) {
  const centerX = gridX * cellSize + cellSize / 2;
  const centerY = gridY * cellSize + cellSize / 2;
  const pulse = 1 + Math.sin(timestamp / 360) * 0.025;
  const bob = Math.sin(timestamp / 300 + 0.8) * cellSize * 0.02;

  context.save();
  context.translate(centerX, centerY + bob);
  context.scale(pulse, pulse);
  context.lineJoin = "round";

  context.save();
  context.shadowColor = "rgba(255, 198, 55, 0.5)";
  context.shadowBlur = 7;
  roundedStarPath(0, 0, 10.5, 5.1);
  context.fillStyle = "rgba(255, 203, 57, 0.3)";
  context.fill();
  context.restore();

  const starGradient = context.createLinearGradient(-7, -10, 7, 10);
  starGradient.addColorStop(0, "#fff49a");
  starGradient.addColorStop(0.35, "#ffd84f");
  starGradient.addColorStop(0.72, "#f4a91f");
  starGradient.addColorStop(1, "#c87812");
  roundedStarPath(0, 0, 10.5, 5.1);
  context.fillStyle = starGradient;
  context.fill();
  context.strokeStyle = "#49301a";
  context.lineWidth = 1.65;
  context.stroke();

  context.save();
  roundedStarPath(0, 0, 10.5, 5.1);
  context.clip();
  const highlight = context.createRadialGradient(-3.8, -4.8, 0, -3.8, -4.8, 8);
  highlight.addColorStop(0, "rgba(255, 255, 255, 0.76)");
  highlight.addColorStop(0.45, "rgba(255, 255, 255, 0.16)");
  highlight.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = highlight;
  context.fillRect(-11, -11, 22, 22);
  context.restore();

  const sparkleAlpha = 0.48 + Math.sin(timestamp / 220) * 0.22;
  drawSparkle(-11.2, -6.8, 2.2, sparkleAlpha);
  drawSparkle(10.8, 6.4, 1.55, sparkleAlpha * 0.82);

  context.restore();
}

function roundedStarPath(centerX, centerY, outerRadius, innerRadius) {
  const points = [];

  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    points.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    });
  }

  const last = points[points.length - 1];
  const first = points[0];
  context.beginPath();
  context.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);

  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  });

  context.closePath();
}

function drawSparkle(x, y, radius, alpha) {
  context.fillStyle = `rgba(255, 250, 198, ${alpha})`;
  context.beginPath();
  context.moveTo(x, y - radius);
  context.quadraticCurveTo(x + radius * 0.22, y - radius * 0.22, x + radius, y);
  context.quadraticCurveTo(x + radius * 0.22, y + radius * 0.22, x, y + radius);
  context.quadraticCurveTo(x - radius * 0.22, y + radius * 0.22, x - radius, y);
  context.quadraticCurveTo(x - radius * 0.22, y - radius * 0.22, x, y - radius);
  context.fill();
}

function drawEyes(head) {
  const baseX = head.x * cellSize;
  const baseY = head.y * cellSize;
  const perpendicular = { x: -direction.y, y: direction.x };
  const forwardOffset = cellSize * 0.18;

  context.fillStyle = "#102119";
  [-1, 1].forEach(side => {
    const eyeX = baseX + cellSize / 2 + direction.x * forwardOffset + perpendicular.x * side * cellSize * 0.17;
    const eyeY = baseY + cellSize / 2 + direction.y * forwardOffset + perpendicular.y * side * cellSize * 0.17;
    context.beginPath();
    context.arc(eyeX, eyeY, 2.7, 0, Math.PI * 2);
    context.fill();
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function endGame() {
  clearInterval(gameLoop);
  isGameOver = true;
  finalScoreElement.textContent = score;
  gameOverElement.classList.add("is-visible");
  gameOverElement.setAttribute("aria-hidden", "false");

  if (qualifiesForTopThree(score)) {
    pendingScore = score;
    recordModal.classList.add("is-visible");
    recordModal.setAttribute("aria-hidden", "false");
    playerNameInput.value = "";
    playerNameInput.focus();
  } else {
    overlayRestartButton.focus();
  }
}

function qualifiesForTopThree(candidateScore) {
  if (!leaderboardReady || candidateScore <= 0) return false;
  return topScores.length < 3 || candidateScore > topScores[topScores.length - 1].score;
}

function renderLeaderboard() {
  leaderboardList.replaceChildren();

  for (let index = 0; index < 3; index += 1) {
    const entry = topScores[index];
    const row = document.createElement("li");
    row.className = `leaderboard-row${entry ? "" : " leaderboard-empty"}`;

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = `${index + 1}.`;

    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = entry ? entry.name : "—";

    const points = document.createElement("span");
    points.className = "leaderboard-score";
    points.textContent = entry ? entry.score : "0";

    row.append(rank, name, points);
    leaderboardList.append(row);
  }
}

function updateBestScore() {
  bestScoreElement.textContent = topScores[0]?.score || 0;
}

function hideRecordModal() {
  recordModal.classList.remove("is-visible");
  recordModal.setAttribute("aria-hidden", "true");
}

async function submitRecord(event) {
  event.preventDefault();
  if (pendingScore === null || scoreSubmissionInProgress) return;

  if (!leaderboardReady || !firebaseUser || !leaderboardCollection || !firebaseApi) {
    pendingScore = null;
    hideRecordModal();
    setLeaderboardStatus("Онлайн класацията временно не е налична", true);
    overlayRestartButton.focus();
    return;
  }

  if (!qualifiesForTopThree(pendingScore)) {
    pendingScore = null;
    hideRecordModal();
    overlayRestartButton.focus();
    return;
  }

  const playerName = playerNameInput.value.trim().slice(0, 12) || "Luigi";
  const submittedScore = Math.max(0, Math.floor(pendingScore));
  scoreSubmissionInProgress = true;
  recordSubmitButton.disabled = true;
  recordSubmitButton.textContent = "Запазване…";

  try {
    const writePromise = firebaseApi.addDoc(leaderboardCollection, {
      name: playerName,
      score: submittedScore,
      uid: firebaseUser.uid,
      createdAt: firebaseApi.serverTimestamp()
    });
    const documentReference = await withTimeout(writePromise, leaderboardWriteTimeout);

    if (!topScores.some(entry => entry.id === documentReference.id)) {
      topScores = [
        ...topScores,
        { id: documentReference.id, name: playerName, score: submittedScore }
      ]
        .sort((first, second) => second.score - first.score)
        .slice(0, 3);
      renderLeaderboard();
      updateBestScore();
    }

    setLeaderboardStatus("");
  } catch {
    setLeaderboardStatus("Онлайн класацията временно не е налична", true);
  } finally {
    pendingScore = null;
    scoreSubmissionInProgress = false;
    recordSubmitButton.disabled = false;
    recordSubmitButton.textContent = "Запази рекорда";
    hideRecordModal();
    overlayRestartButton.focus();
  }
}

function withTimeout(promise, duration) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("Leaderboard request timed out")), duration);
  });

  return Promise.race([promise, timeoutPromise])
    .finally(() => window.clearTimeout(timeoutId));
}

function handleKeydown(event) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const requestedDirection = directionByKey[key];

  if (!requestedDirection) return;
  event.preventDefault();

  requestDirection(requestedDirection);
}

function requestDirection(requestedDirection) {
  if (isGameOver || turnLocked) return;

  const isOpposite = requestedDirection.x === -direction.x && requestedDirection.y === -direction.y;
  if (!isOpposite) {
    nextDirection = requestedDirection;
    turnLocked = true;
  }
}

function handleDpadPointerDown(event) {
  event.preventDefault();

  const requestedDirection = directionByName[event.currentTarget.dataset.direction];
  if (requestedDirection) requestDirection(requestedDirection);
}

function startSwipe(event) {
  if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;

  event.preventDefault();
  swipeStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY
  };

  if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
}

function preventSwipeScroll(event) {
  if (swipeStart && event.pointerId === swipeStart.pointerId) event.preventDefault();
}

function finishSwipe(event) {
  if (!swipeStart || event.pointerId !== swipeStart.pointerId) return;

  event.preventDefault();
  const deltaX = event.clientX - swipeStart.x;
  const deltaY = event.clientY - swipeStart.y;
  swipeStart = null;

  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < swipeThreshold) return;

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    requestDirection(deltaX > 0 ? directionByName.right : directionByName.left);
  } else {
    requestDirection(deltaY > 0 ? directionByName.down : directionByName.up);
  }
}

function cancelSwipe(event) {
  if (swipeStart && event.pointerId === swipeStart.pointerId) swipeStart = null;
}

document.addEventListener("keydown", handleKeydown);
window.addEventListener("resize", configureCanvas);
dpadButtons.forEach(button => button.addEventListener("pointerdown", handleDpadPointerDown));
canvas.addEventListener("pointerdown", startSwipe, { passive: false });
canvas.addEventListener("pointermove", preventSwipeScroll, { passive: false });
canvas.addEventListener("pointerup", finishSwipe, { passive: false });
canvas.addEventListener("pointercancel", cancelSwipe);
restartButton.addEventListener("click", startGame);
overlayRestartButton.addEventListener("click", startGame);
recordForm.addEventListener("submit", submitRecord);

configureCanvas();
renderLeaderboard();
startGame();
initializeOnlineLeaderboard();
