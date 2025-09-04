// =========================
// Asparagus — Mobile Prototype
// =========================

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// ── Геймплей ──────────────────────────────────────────────────────
const FALL_ANGLE = 0.5;
const DAMPING = 0.0011;
const MAX_ANGVEL = 0.0030;

const DRIFT_MAX_START  = 0.00018;
const DRIFT_MAX_GROWTH = 0.00000018;
const DRIFT_CHANGE_EVERY = 2600;
const SOFT_START_MS = 1800;

// Керування: сила завжди у свій бік (можна перетнути 0°)
const HOLD_FORCE = 0.0035;
const TAP_IMPULSE = 0.0080;
const TAP_COOLDOWN_MS = 110;

const STABILIZE_GAIN   = 1.0;
const STABILIZE_SMOOTH = 0.18;

const RIGHT_POSE_ON = 0.42;
const LEFT_POSE_ON  = -0.42;

const INSTABILITY_GAIN = 0.00055;
const ANGLE_COMMIT     = 0.06;
const COMMIT_PUSH      = 0.00012;

const BOARD_Y_RATIO = 0.75;

// ── Динамічна геометрія дошки ────────────────────────────────────
const PLANK = {
  thickness: () => Math.max(10, Math.round(canvas.height * 0.01)),
  len:       () => Math.round(canvas.width * 0.70),
  cx:        () => canvas.width / 2,
  cy:        () => Math.round(canvas.height * BOARD_Y_RATIO)
};

// ── ROCKS (стопка під дошкою) ────────────────────────────────────
const ROCKS_SRC = "/static/img/rocks.svg";
const rocksImg = new Image();
rocksImg.src = ROCKS_SRC;
let rocksReady = false, rocksAR = 1;
rocksImg.onload = ()=>{
  rocksReady = true;
  rocksAR = rocksImg.naturalWidth / rocksImg.naturalHeight || 1;
};

const ROCKS_SCALE = 0.8;

function drawRocks(){
  if(!rocksReady) return;
  const t   = PLANK.thickness();
  const len = PLANK.len();

  const maxW = Math.min(len * 0.42, canvas.width * 0.50);
  const minW = Math.max(100, len * 0.20);
  let targetW = Math.max(minW, Math.min(maxW, len * 0.15));
  let targetH = targetW / rocksAR;

  targetW *= ROCKS_SCALE;
  targetH *= ROCKS_SCALE;

  const x = PLANK.cx() - targetW / 2;
  const overlap = Math.min(10, Math.max(2, Math.round(t * 0.25)));
  const y = PLANK.cy() + t/2 - overlap;

  ctx.drawImage(rocksImg, x, y, targetW, targetH);
}

// ── Стан ──────────────────────────────────────────────────────────
let angle=0, angVel=0, drift=0, driftTarget=0, lastDriftChange=performance.now();
let alive=true, startTs=performance.now(), scoreMs=0, bestMs=0;

const keys={ArrowLeft:false, ArrowRight:false};
let lastTapLeft=-Infinity, lastTapRight=-Infinity;
let biasSign = 0;
let lastLossSide = null; // 'right' | 'left' | null

// Recovery tween
let recovering = false;
let recoverStart = 0;
const RECOVER_DUR_MS = 700;
let recoverFromAngle = 0;
let recoverSide = null;

// Reverse flags
let reversePlaying = false;
let reverseDone = false;
let tweenDone = false;

// ── Кнопка рестарту ──────────────────────────────────────────────
const retryBtn = document.getElementById("retryBtn");

// ── Ввід з клавіатури ────────────────────────────────────────────
document.addEventListener("keydown", (e)=>{
  if(e.key==="ArrowLeft" && !keys.ArrowLeft){
    keys.ArrowLeft = true;
    const now=performance.now();
    if(now-lastTapLeft>TAP_COOLDOWN_MS){ angVel-=TAP_IMPULSE; lastTapLeft=now; }
  }
  if(e.key==="ArrowRight" && !keys.ArrowRight){
    keys.ArrowRight = true;
    const now=performance.now();
    if(now-lastTapRight>TAP_COOLDOWN_MS){ angVel+=TAP_IMPULSE; lastTapRight=now; }
  }

  // R — recovery з реверсом або hard reset
  if(e.key.toLowerCase()==="r"){
    if(lastLossSide && !recovering && !reversePlaying){
      startRecoveryWithReverse(lastLossSide);
    }else{
      hardReset();
    }
  }

  if(e.key.toLowerCase()==="c") toggleCalib();
  if(calib.enabled){
    if(e.key==="["){ calib.pivotY-=2; applyPivot(); layoutLottie(); }
    if(e.key==="]"){ calib.pivotY+=2; applyPivot(); layoutLottie(); }
    if(e.key==="-"){ setScale(calib.width-6); layoutLottie(); }
    if(e.key==="=" || e.key==="+"){ setScale(calib.width+6); layoutLottie(); }
    if(e.key==="'"){ calib.pivotX+=2; applyPivot(); layoutLottie(); }
    if(e.key===";"){ calib.pivotX-=2; applyPivot(); layoutLottie(); }
  }
}, {passive:false});

document.addEventListener("keyup",(e)=>{
  if(e.key==="ArrowLeft") keys.ArrowLeft=false;
  if(e.key==="ArrowRight") keys.ArrowRight=false;
}, {passive:false});

// ── Ввід з екрана (тач/миша) ─────────────────────────────────────
const btnLeft  = document.getElementById("btnLeft");
const btnRight = document.getElementById("btnRight");

function pressLeft(){
  if(!keys.ArrowLeft){
    keys.ArrowLeft = true;
    const now=performance.now();
    if(now-lastTapLeft>TAP_COOLDOWN_MS){ angVel-=TAP_IMPULSE; lastTapLeft=now; }
  }
}
function releaseLeft(){ keys.ArrowLeft = false; }

function pressRight(){
  if(!keys.ArrowRight){
    keys.ArrowRight = true;
    const now=performance.now();
    if(now-lastTapRight>TAP_COOLDOWN_MS){ angVel+=TAP_IMPULSE; lastTapRight=now; }
  }
}
function releaseRight(){ keys.ArrowRight = false; }

function bindPointerHold(el, onDown, onUp){
  if(!el) return;
  const down = (e)=>{ e.preventDefault(); onDown(); };
  const up   = (e)=>{ e.preventDefault(); onUp(); };
  el.addEventListener("pointerdown", down, {passive:false});
  el.addEventListener("pointerup", up, {passive:false});
  el.addEventListener("pointercancel", up, {passive:false});
  el.addEventListener("pointerleave", up, {passive:false});
}
bindPointerHold(btnLeft,  pressLeft,  releaseLeft);
bindPointerHold(btnRight, pressRight, releaseRight);

document.addEventListener("gesturestart", (e)=> e.preventDefault(), {passive:false});

// ── Скидання/Recovery ─────────────────────────────────────────────
function hardReset(){
  angle=0; angVel=0; drift=0; driftTarget=0; lastDriftChange=performance.now();
  alive=true; startTs=performance.now(); scoreMs=0; biasSign=0;
  recovering=false; lastLossSide=null; recoverSide=null;
  smoothCounter=0;
  reversePlaying=false; reverseDone=false; tweenDone=false;

  // ховаємо кнопку на старті
  retryBtn && retryBtn.classList.add("hidden");

  // стартовий дрейф
  const seedSign = Math.random() < 0.5 ? -1 : 1;
  const seedMag  = DRIFT_MAX_START * (0.6 + 0.4*Math.random());
  driftTarget = seedSign * seedMag;
  drift = driftTarget * 0.5;

  // скидаємо анімації
  if (animBase ){ animBase.pause(); animBase.goToAndStop(0, true); }
  if (animRight){ animRight.stop(); animRight.goToAndStop(0, true); animRight.setDirection(1); }
  if (animLeft ){ animLeft .stop(); animLeft .goToAndStop(0, true); animLeft .setDirection(1); }

  setPoseImmediate("base");
  requestAnimationFrame(()=> animBase && animBase.play());
}

function startRecoveryWithReverse(side){
  // під час recovery кнопку ховаємо
  retryBtn && retryBtn.classList.add("hidden");

  recovering = true;
  reversePlaying = true;
  reverseDone = false;
  tweenDone = false;

  alive = false;
  recoverSide = side;
  recoverStart = performance.now();
  recoverFromAngle = angle;

  angVel = 0; drift = 0; driftTarget = 0; biasSign = 0;
  smoothCounter = 0;

  if (animBase){ animBase.pause(); animBase.goToAndStop(0, true); }

  if(side === "right"){
    setPoseImmediate("right");
    if(animRight){
      animRight.removeEventListener("complete", onReverseComplete);
      animRight.setDirection(-1);
      animRight.goToAndPlay(Math.max(0, (animRight.totalFrames||1)-1), true);
      animRight.addEventListener("complete", onReverseComplete);
    }
  }else{
    setPoseImmediate("left");
    if(animLeft){
      animLeft.removeEventListener("complete", onReverseComplete);
      animLeft.setDirection(-1);
      animLeft.goToAndPlay(Math.max(0, (animLeft.totalFrames||1)-1), true);
      animLeft.addEventListener("complete", onReverseComplete);
    }
  }
}

function onReverseComplete(){
  reverseDone = true;

  if (recoverSide === "right" && animRight){
    animRight.removeEventListener("complete", onReverseComplete);
    animRight.stop(); animRight.goToAndStop(0, true); animRight.setDirection(1);
  }
  if (recoverSide === "left" && animLeft){
    animLeft.removeEventListener("complete", onReverseComplete);
    animLeft.stop(); animLeft.goToAndStop(0, true); animLeft.setDirection(1);
  }

  if(tweenDone && reversePlaying){
    finishRecoveryToBase();
  }
}

function finishRecoveryToBase(){
  reversePlaying = false;
  reverseDone = false;
  tweenDone = false;
  recovering = false;

  if (animBase){ animBase.goToAndStop(0, true); }
  setPoseImmediate("base");
  requestAnimationFrame(()=> animBase && animBase.play());

  angle = 0; angVel = 0; smoothCounter = 0;
  lastLossSide = null;
  alive = true;
  startTs = performance.now();

  const seedSign = Math.random() < 0.5 ? -1 : 1;
  const seedMag  = DRIFT_MAX_START * (0.5 + 0.3*Math.random());
  driftTarget = seedSign * seedMag;
  drift = driftTarget * 0.4;
}

function easeOutCubic(x){ return 1 - Math.pow(1 - x, 3); }

// ── Фізика ────────────────────────────────────────────────────────
function updateDrift(dt, now){
  const elapsed = now - startTs;
  let driftMax = DRIFT_MAX_START + DRIFT_MAX_GROWTH*elapsed;

  if(elapsed < SOFT_START_MS){
    const k = elapsed / SOFT_START_MS;
    driftMax *= 0.25 + 0.75*k;
  }

  if(now - lastDriftChange > DRIFT_CHANGE_EVERY){
    lastDriftChange = now;
    const signPref = (Math.abs(angle) > 0.02) ? Math.sign(angle) : (Math.random()<0.5?-1:1);
    const mag = (0.65 + 0.35*Math.random()) * driftMax;
    driftTarget = signPref * mag;
  }

  drift += (driftTarget - drift) * 0.012 * dt;
}

function update(dt){
  // 1) Tween recovery
  if(recovering){
    const k = Math.min(1, (performance.now() - recoverStart) / RECOVER_DUR_MS);
    const e = easeOutCubic(k);
    angle = recoverFromAngle * (1 - e);
    if(k>=1){
      recovering = false;
      tweenDone = true;
      if(reverseDone){
        finishRecoveryToBase();
      }
    }
    return;
  }

  // 2) Нормальний апдейт
  if(!alive && (poseState==="transitionRight" || poseState==="transitionLeft")) return;
  if(!alive) return;

  const now=performance.now();
  updateDrift(dt, now);

  // «нестабільність»
  angVel += drift * dt;
  angVel += INSTABILITY_GAIN * angle * dt;

  // Безумовні керуючі сили (дають перетин 0°)
  if(keys.ArrowRight) angVel += HOLD_FORCE * dt;
  if(keys.ArrowLeft)  angVel -= HOLD_FORCE * dt;

  // commit bias
  if (Math.abs(angle) > ANGLE_COMMIT) {
    biasSign = Math.sign(angle);
  } else if (Math.abs(angle) < ANGLE_COMMIT * 0.6) {
    biasSign = 0;
  }
  if (biasSign !== 0) {
    angVel += COMMIT_PUSH * biasSign * dt;
  }

  // демпфування, обмеження, інтеграція
  angVel *= (1 - DAMPING*dt);
  angVel = Math.max(-MAX_ANGVEL, Math.min(MAX_ANGVEL, angVel));
  angle += angVel;

  // тригери поз/падіння
  if(poseState==="base"){
    if(angle > RIGHT_POSE_ON) triggerLoss("right");
    else if(angle < LEFT_POSE_ON) triggerLoss("left");
  }
  if(alive && Math.abs(angle) > FALL_ANGLE){
    triggerLoss(angle>0 ? "right" : "left");
  }
}

// ── Малювання ─────────────────────────────────────────────────────
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // 1) Камені
  drawRocks();

  // 2) Платформа
  const t = PLANK.thickness();
  const len = PLANK.len();
  ctx.save();
  ctx.translate(PLANK.cx(), PLANK.cy());
  ctx.rotate(angle);
  ctx.fillStyle = "#aa808d";
  ctx.fillRect(-len/2, -t/2, len, t);
  ctx.restore();
}

// ── Lottie та позиціонування (responsive) ────────────────────────
const lottieWrap = document.getElementById("asparagusWrap");
const baseEl     = document.getElementById("lottieBase");
const rightEl    = document.getElementById("lottieRight");
const leftEl     = document.getElementById("lottieLeft");

let animBase=null, animRight=null, animLeft=null;

const LOTTIE_PATHS = {
  base:  "/static/lottie/base.json",
  right: "/static/lottie/right.json",
  left:  "/static/lottie/left.json"
};

const calibHUD = document.createElement("div");
calibHUD.className = "calib-hud hidden";
document.querySelector(".stage").appendChild(calibHUD);

// Калібрування/скейл (JSON 512×512)
const calib = {
  enabled:false,
  width:200, height:200, aspect:1.0,
  pivotX:100, pivotY:100
};

let footOffset = 0;
const CHAR_WIDTH_RATIO = 1.0;
const CHAR_HEIGHT_MAX_RATIO = 0.8;

function autoscaleLayout(){
  let targetW = Math.round(canvas.width * CHAR_WIDTH_RATIO);
  const maxByHeight = Math.round(canvas.height * CHAR_HEIGHT_MAX_RATIO);
  calib.width  = Math.max(160, Math.min(targetW, maxByHeight));
  calib.height = calib.width;
  calib.aspect = 1;

  calib.pivotX = calib.width * (256/512);
  calib.pivotY = calib.width * (490/512);

  footOffset = Math.round(calib.width * (34/200));

  applySize();
  applyPivot();
  layoutLottie();
}

function setScale(newWidth){
  const prevW = calib.width, prevH = calib.height;
  calib.width  = Math.max(120, Math.min(Math.round(canvas.width*0.8), newWidth));
  calib.height = calib.width;
  const sx = calib.width / prevW, sy = calib.height / prevH;
  if (isFinite(sx)) calib.pivotX *= sx;
  if (isFinite(sy)) calib.pivotY *= sy;
  footOffset = Math.round(calib.width * (34/200));
  applySize(); applyPivot(); layoutLottie();
}
function applySize(){
  lottieWrap.style.width  = `${calib.width}px`;
  lottieWrap.style.height = `${calib.height}px`;
}
function applyPivot(){
  const p = `${calib.pivotX}px ${calib.pivotY}px`;
  lottieWrap.style.transformOrigin = p;
  baseEl.style.transformOrigin = p;
  rightEl.style.transformOrigin = p;
  leftEl.style.transformOrigin  = p;
  updateHUD();
}
function updateHUD(){
  if(!calib.enabled) return;
  calibHUD.textContent =
    `POSE=${poseState}${recovering?"(recover)":""}${reversePlaying?"(reverse)":""}  `+
    `width=${Math.round(calib.width)}  pivotX=${Math.round(calib.pivotX)}  pivotY=${Math.round(calib.pivotY)}`;
}
function toggleCalib(){ calib.enabled=!calib.enabled; calibHUD.classList.toggle("hidden", !calib.enabled); updateHUD(); }

function layoutLottie(){
  const t = PLANK.thickness();
  const cx = PLANK.cx();
  const topY = PLANK.cy() - t/2;
  lottieWrap.style.left = `${cx - calib.pivotX}px`;
  lottieWrap.style.top  = `${topY - calib.pivotY - footOffset}px`;
}

function initLottie(){
  if(!window.lottie){ setTimeout(initLottie,50); return; }

  animBase  = lottie.loadAnimation({
    container: baseEl, renderer:"svg", loop:true, autoplay:true, path: LOTTIE_PATHS.base
  });
  animRight = lottie.loadAnimation({
    container: rightEl, renderer:"svg", loop:false, autoplay:false, path: LOTTIE_PATHS.right
  });
  animLeft  = lottie.loadAnimation({
    container: leftEl,  renderer:"svg", loop:false, autoplay:false, path: LOTTIE_PATHS.left
  });

  autoscaleLayout();
  setPoseImmediate("base");
}
initLottie();

window.addEventListener("resize", autoscaleLayout);

// ── Пози та «довороти» ───────────────────────────────────────────
let poseState="base"; // 'base' | 'right' | 'left' | 'transitionRight' | 'transitionLeft'
let smoothCounter=0;

const TRANS_DUR_MS = 140;
let transition = { active:false, target:null, start:0, startInner:0 };

function setPoseImmediate(pose){
  poseState = pose;

  // сховати все
  baseEl.style.display="none";
  rightEl.style.display="none";
  leftEl.style.display="none";

  if (pose === "base"){
    baseEl.style.display="block";
  } else if (pose === "right"){
    rightEl.style.display="block";
  } else if (pose === "left"){
    leftEl.style.display="block";
  }

  // скид внутрішнього шару
  baseEl.style.transform = `rotate(${-smoothCounter}rad)`;
}

function triggerLoss(target){
  const now = performance.now();
  scoreMs = now - startTs; bestMs = Math.max(bestMs, scoreMs);
  alive = false;
  lastLossSide = target;

  transition.active = true;
  transition.target = target;
  transition.start  = now;
  transition.startInner = -smoothCounter; // кут base відносно платформи
  poseState = target === "right" ? "transitionRight" : "transitionLeft";

  // показуємо лише base на час короткого «довороту»
  baseEl.style.display = "block";
  rightEl.style.display= "none";
  leftEl.style.display = "none";

  // показати кнопку «Спробувати ще»
  if(retryBtn) retryBtn.classList.remove("hidden");
}

function stepTransition(now){
  if(!transition.active) return;
  const k = Math.min(1, (now - transition.start) / TRANS_DUR_MS);
  baseEl.style.transform = `rotate(${transition.startInner * (1 - k)}rad)`;
  if(k >= 1){
    transition.active = false;

    // миттєве перемикання на праву/ліву позу і програвання УПЕРЕД (поразка)
    if(transition.target === "right"){
      setPoseImmediate("right");
      if(animRight){ animRight.setDirection(1); animRight.goToAndPlay(0, true); }
    }else{
      setPoseImmediate("left");
      if(animLeft){ animLeft.setDirection(1); animLeft.goToAndPlay(0, true); }
    }
  }
}

// Обертання / синхронізація Lottie з платформою
function syncLottieRotation(dt){
  lottieWrap.style.transform = `rotate(${angle}rad)`;
  const now = performance.now();

  if(poseState === "base"){
    const targetCounter = angle * STABILIZE_GAIN;
    const alpha = 1 - Math.pow(1 - STABILIZE_SMOOTH, dt/16.67);
    smoothCounter += (targetCounter - smoothCounter) * alpha;
    baseEl.style.transform = `rotate(${-smoothCounter}rad)`;

  }else if(poseState === "transitionRight" || poseState === "transitionLeft"){
    stepTransition(now);

  }else{
    baseEl.style.transform = "rotate(0rad)";
  }
}

// подія кліку на кнопку рестарту
retryBtn && retryBtn.addEventListener("click", ()=>{
  retryBtn.classList.add("hidden");
  hardReset();
});

// ── Loop ──────────────────────────────────────────────────────────
let lastTs = performance.now();
function loop(){
  const now=performance.now();
  const dt = Math.min(40, now-lastTs); lastTs = now;

  update(dt);
  draw();
  layoutLottie();
  syncLottieRotation(dt);

  requestAnimationFrame(loop);
}
loop();

