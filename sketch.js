// sheet image is no longer used; individual card images are in /images/
const COLS = 5;
const ROWS = 4;
let sheetTileW, sheetTileH;
let cardSprites = [];
let seaSprites = {};
let cardDefs = [];
let grid = []; // each cell is an array (stack) of card ids
let selected = -1;
let seaMode = null; // 'whale' | 'shark' | null
let seaSource = -1;
let message = 'Click a card to select a predator.';
let restartButton;
let canvasW, canvasH;
let dispTileW, dispTileH;
let pagePadding = 25;
let gridX = pagePadding, gridY = 100, spacing = 10;
let seaX, seaY;
let seaOrientation = 'right';
let seaUsed = { whale: false, shark: false };
let gameOver = false;

// history stack for undo support
let history = [];
let undoButton;

function recordState(label) {
  const snapshot = {
    label: label || '',
    grid: grid.map(arr => arr.slice()),
    selected,
    seaMode,
    seaSource,
    pendingNext,
    pendingNextQueued,
    pendingRaccoonTurns,
    pendingRaccoonQueued,
    polarBearSkip,
    actionMode: actionMode ? JSON.parse(JSON.stringify(actionMode)) : null,
    queuedRaccoonDiscard,
    lastEaterIndex,
    lastEatDiff: typeof lastEatDiff !== 'undefined' ? lastEatDiff : null,
    seaUsed: { ...seaUsed },
    gameOver,
    message
  };
  history.push(snapshot);
  updateUndoButton();
}

function updateUndoButton() {
  if (!undoButton) return;
  const enabled = history.length > 0;
  // enable/disable the native control and give a visual hint
  undoButton.elt.disabled = !enabled;
  undoButton.style('opacity', enabled ? '1' : '0.5');
}

function undoLast() {
  if (history.length === 0) { message = 'Nothing to undo.'; return; }
  const s = history.pop();
  grid = s.grid.map(arr => arr.slice());
  selected = s.selected;
  seaMode = s.seaMode;
  seaSource = s.seaSource;
  pendingNext = s.pendingNext;
  pendingNextQueued = s.pendingNextQueued;
  pendingRaccoonTurns = s.pendingRaccoonTurns;
  pendingRaccoonQueued = s.pendingRaccoonQueued;
  polarBearSkip = s.polarBearSkip;
  actionMode = s.actionMode ? JSON.parse(JSON.stringify(s.actionMode)) : null;
  queuedRaccoonDiscard = s.queuedRaccoonDiscard;
  lastEaterIndex = s.lastEaterIndex;
  lastEatDiff = s.lastEatDiff;
  seaUsed = { ...s.seaUsed };
  gameOver = s.gameOver;
  message = s.message || 'Undid previous action.';
  updateUndoButton();
}

let layoutSelect;
let selectedLayout = '1';
let finishButton;
let layoutPattern = [];

// game state flags for card-specific abilities
let pendingNext = null; // 'fox','lynx','tiger','lion','gator' - applies to the next predator only
let pendingNextQueued = null; // queued to become active at end-of-turn
let pendingRaccoonTurns = 0; // when >0 counts down at end-of-turn; value==1 means raccoon effect applies this turn
let pendingRaccoonQueued = false; // set when a Raccoon ability is used; becomes active next turn
let polarBearSkip = false; // when true, Polar Bear cannot be used to eat on the next turn
let actionMode = null; // interactive ability resolution state
let queuedRaccoonDiscard = false; // when true, run raccoon discard after current actionMode completes
let lastEaterIndex = -1; // index of the last eater (set by performEat) to ensure 'next' abilities only trigger for actual eaters
let queuedPredatorAfterRaccoon = -1; // if set, run runAbilityAt(index) after raccoon discard completes
let lastEatDiff = null; // difference (pred - prey) for the most recent eat this turn

function preload() {
  // load numbered card images (0..15) from images/ and sea animals
  cardSprites = [];
  for (let i = 0; i < 16; i++) {
    cardSprites[i] = loadImage('images/' + i + '.png');
  }
  seaSprites.whale = loadImage('images/whale.png');
  seaSprites.shark = loadImage('images/shark.png');
}

function setup() {
  canvasW = min(windowWidth, 1100);
  canvasH = min(windowHeight, 800);
  createCanvas(canvasW, canvasH);
  // Ensure consistent touch/mouse mapping on mobile
  const canvasElt = document.querySelector('canvas');
  if (canvasElt) {
    // prevent the browser from scrolling when interacting with the canvas
    canvasElt.style.touchAction = 'none';
    canvasElt.addEventListener('touchstart', function (e) {
      if (!e.touches || e.touches.length === 0) return;
      e.preventDefault();
      const rect = canvasElt.getBoundingClientRect();
      const scaleX = canvasElt.width / rect.width;
      const scaleY = canvasElt.height / rect.height;
      const x = (e.touches[0].clientX - rect.left) * scaleX;
      const y = (e.touches[0].clientY - rect.top) * scaleY;
      pointerPressed(x, y);
    }, { passive: false });
  }
  textFont('Arial');

  // use loaded card images; set canonical sheet tile size from first card
  if (cardSprites.length > 0 && cardSprites[0]) {
    sheetTileW = cardSprites[0].width;
    sheetTileH = cardSprites[0].height;
  } else {
    sheetTileW = 200;
    sheetTileH = 300;
  }

  // card metadata in sheet order (row-major) with tooltip descriptions
  cardDefs = [
    { name: 'Plant', value: 0, desc: 'Plant — No ability; considered an animal card.' },
    { name: 'Ant', value: 1, desc: 'Ant — Move one animal 1–3 spaces.' },
    { name: 'Spider', value: 2, desc: 'Spider — Move two animals 1 space each.' },
    { name: 'Mouse', value: 3, desc: 'Mouse — Move one animal 1–2 spaces.' },
    { name: 'Lizard', value: 4, desc: 'Lizard — Remove 1 unstacked animal of your choice.' },
    { name: 'Rat', value: 5, desc: 'Rat — Move one animal 2 spaces.' },
    { name: 'Bat', value: 6, desc: 'Bat — After the Bat eats, move it to any other open space (cannot stack).' },
    { name: 'Snake', value: 7, desc: 'Snake — Swap the location of two cards.' },
    { name: 'Raccoon', value: 8, desc: 'Raccoon — Next turn: if you eat a card valued exactly 1 below, discard 1 unstacked animal.' },
    { name: 'Fox', value: 9, desc: 'Fox — Next turn: the animal must move diagonally 1 space to eat.' },
    { name: 'Lynx', value: 10, desc: 'Lynx — Next turn: the animal must jump over one animal to eat a prey two spaces away.' },
    { name: 'Wolf', value: 11, desc: 'Wolf — After the Wolf eats, move its entire stack 1 space.' },
    { name: 'Tiger', value: 12, desc: 'Tiger — Next turn: the animal may move two spaces (can change direction) to reach prey.' },
    { name: 'Gator', value: 13, desc: 'Gator — After the Gator eats, the next eat reverses movement: the eaten animal moves under the eater (opposite stacking).' },
    { name: 'Lion', value: 14, desc: 'Lion — Next turn: the prey must be valued exactly 1 less than the predator.' },
    { name: 'Polar Bear', value: 15, desc: 'Polar Bear — After use, you cannot use the Polar Bear to eat on the next turn.' }
  ];

  // create UI button
  restartButton = createButton('Restart');
  restartButton.position(pagePadding + 75, pagePadding + 25);
  restartButton.mousePressed(initGame);

  // layout selector for alternative starting boards
  layoutSelect = createSelect();
  layoutSelect.position(pagePadding + 175, pagePadding + 25);
  layoutSelect.option('1 - Default', '1');
  layoutSelect.option('2 - Zig', '2');
  layoutSelect.option('3 - Circle', '3');
  layoutSelect.option('4 - Castle', '4');
  layoutSelect.option('5 - Columns', '5');
  layoutSelect.option('6 - Tower', '6');
  layoutSelect.option('7 - Right Space', '7');
  layoutSelect.selected(selectedLayout);
  layoutSelect.changed(() => { selectedLayout = layoutSelect.value(); initGame(); });

  // Finish button (evaluates final score / forces game end)
  finishButton = createButton('Finish');
  finishButton.position(pagePadding + 295, pagePadding + 25);
  finishButton.mousePressed(finishGame);

  // Undo button (disabled initially)
  undoButton = createButton('Undo');
  undoButton.position(pagePadding + 365, pagePadding + 25);
  undoButton.mousePressed(undoLast);
  undoButton.elt.disabled = true;
  undoButton.style('opacity', '0.5');

  initGame();
}

function initGame() {
  // shuffle and deal the land cards into the map according to the selected layout
  let deck = [];
  for (let i = 0; i < cardDefs.length; i++) deck.push(i);
  shuffle(deck, true);

  const pattern = getLayoutPattern(selectedLayout || '1');
  // remember layout pattern for move validation
  layoutPattern = pattern.slice();
  grid = [];
  let di = 0;
  for (let i = 0; i < ROWS * COLS; i++) {
    if (pattern[i] && di < deck.length) {
      grid.push([deck[di++]]);
    } else {
      grid.push([]);
    }
  }

  // layout variables (respect page padding)
  gridX = pagePadding;
  gridY = 100; // increased top offset
  spacing = 10;

  // Desired tile size: choose a sensible base per-row height (capped)
  const baseTileH = Math.min(140, Math.max(36, Math.floor((windowHeight - 220) / ROWS)));
  // Default visual scale: larger cards on desktop, but allow scaling to fit mobile
  let desiredScale = 2; // originally doubled card size
  dispTileH = Math.max(24, Math.floor(baseTileH * desiredScale));
  dispTileW = Math.floor(dispTileH * (sheetTileW / sheetTileH));

  seaX = gridX + COLS * (dispTileW + spacing) + 40;
  seaY = gridY;

  // Compute required canvas size to contain grid, sea area, and message area (with margin)
  let requiredCanvasH = gridY + ROWS * (dispTileH + spacing) + 160;
  const seaInfoWidth = dispTileW + 220; // room for sea image + description text
  let requiredCanvasW = seaX + seaInfoWidth + 20;

  // If the required canvas doesn't fit the viewport, compute a uniform scale factor and shrink tile sizes
  const marginW = 32;
  const marginH = 48;
  const maxAvailableW = Math.max(320, windowWidth - marginW - pagePadding * 2);
  const maxAvailableH = Math.max(240, windowHeight - marginH - pagePadding * 2);
  const scaleFactor = Math.min(1, maxAvailableW / requiredCanvasW, maxAvailableH / requiredCanvasH);
  if (scaleFactor < 1) {
    dispTileH = Math.max(20, Math.floor(dispTileH * scaleFactor));
    dispTileW = Math.floor(dispTileH * (sheetTileW / sheetTileH));
    seaX = gridX + COLS * (dispTileW + spacing) + 24;
    // recompute required dims after scaling
    requiredCanvasH = gridY + ROWS * (dispTileH + spacing) + 140;
    requiredCanvasW = seaX + (dispTileW + 200) + 20;
  }

  // Decide whether to place the sea panel to the right or below the grid to avoid overlaps
  const seaPanelMinWidth = dispTileW + 180;
  const spaceRight = Math.max(0, windowWidth - (gridX + COLS * (dispTileW + spacing) + 40));
  if (spaceRight < seaPanelMinWidth) {
    seaOrientation = 'below';
    seaX = gridX;
    seaY = gridY + ROWS * (dispTileH + spacing) + 30;
    // for below orientation, ensure canvas height includes sea panel
    requiredCanvasH = seaY + (dispTileH * 2) + 100;
    requiredCanvasW = Math.max(requiredCanvasW, gridX + COLS * (dispTileW + spacing) + 20);
  } else {
    seaOrientation = 'right';
    seaX = gridX + COLS * (dispTileW + spacing) + 40;
    seaY = gridY;
    requiredCanvasH = gridY + ROWS * (dispTileH + spacing) + 160;
    requiredCanvasW = seaX + (dispTileW + 200) + 20;
  }

  // Final canvas fits the content (and should now be <= viewport in most cases)
  canvasW = Math.max(320, Math.min(requiredCanvasW, windowWidth - pagePadding * 2));
  canvasH = Math.max(240, Math.min(requiredCanvasH, windowHeight - pagePadding * 2));
  resizeCanvas(canvasW, canvasH);

  selected = -1;
  seaMode = null;
  seaSource = -1;
  // clear ability and temporary state on restart
  pendingNext = null;
  pendingNextQueued = null;
  pendingRaccoonTurns = 0;
  pendingRaccoonQueued = false;
  polarBearSkip = false;
  actionMode = null;
  queuedRaccoonDiscard = false;
  lastEaterIndex = -1;
  lastEatDiff = null;
  message = 'Click a card to select a predator. Use sea animals on the right.';
  seaUsed = { whale: false, shark: false };
  gameOver = false;

  // reset undo history on new game
  history = [];
  updateUndoButton();

  // Reposition UI elements to account for layout/resize (keep +75px horizontal offset)
  // On narrow viewports stack controls for easier tapping
  const isMobileLayout = windowWidth <= 600 || canvasW <= 600;
  if (isMobileLayout) {
    if (restartButton) restartButton.position(pagePadding, pagePadding + 6).style('font-size', '18px');
    if (layoutSelect) layoutSelect.position(pagePadding, pagePadding + 56).style('width', '180px');
  } else {
    if (restartButton) restartButton.position(pagePadding + 75, pagePadding + 25).style('font-size', '16px');
    if (layoutSelect) layoutSelect.position(pagePadding + 175, pagePadding + 25).style('width', '120px');
  }
  // position finish button under the grid
  if (finishButton) {
    // compute whale/shark image height to mirror draw() positioning when sea panel is below
    const whaleW = dispTileW;
    const whaleH = Math.floor(whaleW * (sheetTileH / sheetTileW));
    let messageY = gridY + ROWS * (dispTileH + spacing) + 20;
    if (seaOrientation === 'below') {
      const bottomSea = seaY + whaleH + 12;
      messageY = bottomSea + 20;
    }
    const finishY = messageY + 91; // move finish button further down by 25px
    const finishX = isMobileLayout ? pagePadding : gridX + 75;
    finishButton.position(finishX, finishY).style('font-size', isMobileLayout ? '18px' : '16px');
    if (undoButton) {
      if (isMobileLayout) undoButton.position(finishX + 140, finishY).style('font-size', '18px');
      else {
        // position undo to the right of finish (try to use actual button width)
        const finishW = (finishButton.elt && finishButton.elt.getBoundingClientRect) ? finishButton.elt.getBoundingClientRect().width : 80;
        undoButton.position(finishX + finishW + 8, finishY).style('font-size', '16px');
      }
    }
  }
}

function windowResized() {
  // Recompute layout and resize canvas for the new viewport
  initGame();
}

function draw() {
  background(200, 245, 220);

  let hoveredCard = -1;

  // title
  fill(30);
  textSize(20);
  text('Food Chain Island — Solo (playable demo)', gridX, 40);

  // legend for layout tiles (moved down 10px)
  textSize(12);
  fill(60);
  text('Yellow = pass-through (cannot land). Use the layout selector to preview.', gridX, 74);

  // draw grid
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let i = r * COLS + c;
      let x = gridX + c * (dispTileW + spacing);
      let y = gridY + r * (dispTileH + spacing);

      // tile background
      if (layoutPattern && !layoutPattern[i]) {
        // Y spots: passable but not landable — color them yellow
        fill(255, 230, 120);
      } else {
        fill(245);
      }
      stroke(180);
      strokeWeight(1);
      rect(x - 6, y - 6, dispTileW + 12, dispTileH + 12, 8);

      if (grid[i].length > 0) {
        let topId = grid[i][grid[i].length - 1];
        image(cardSprites[topId], x, y, dispTileW, dispTileH);

        // stack count
        if (grid[i].length > 1) {
          fill(0, 150);
          noStroke();
          rect(x + dispTileW - 38, y + dispTileH - 28, 34, 22, 6);
          fill(255);
          textSize(14);
          textAlign(CENTER, CENTER);
          text(grid[i].length, x + dispTileW - 21, y + dispTileH - 17);
        }

        // value label (bold when stacked)
        push();
        fill(255);
        stroke(0, 120);
        strokeWeight(2);
        textSize(14);
        if (grid[i].length > 1) textStyle(BOLD);
        else textStyle(NORMAL);
        textAlign(RIGHT, TOP);
        let value = cardDefs[topId].value;
        text(value, x + dispTileW - 8, y + 8);
        textStyle(NORMAL);
        pop();
      } else {
        // empty slot
        noFill();
        stroke(180);
        strokeWeight(1);
        rect(x, y, dispTileW, dispTileH, 6);
      }

      // highlight selected
      if (selected === i) {
        noFill();
        stroke(40, 180, 40);
        strokeWeight(4);
        rect(x - 6, y - 6, dispTileW + 12, dispTileH + 12, 8);
      }

      // highlight valid prey when a predator is selected (use rules-aware check to include Tiger/Lynx/Fox/etc.)
      if (selected >= 0 && grid[selected].length > 0) {
        const can = canEat(selected, i, false);
        if (can.ok && i !== selected) {
          noFill();
          stroke(0, 160, 200);
          strokeWeight(3);
          rect(x - 6, y - 6, dispTileW + 12, dispTileH + 12, 8);
        }
      }
      // detect hover for tooltip
      if (mouseX >= x && mouseX <= x + dispTileW && mouseY >= y && mouseY <= y + dispTileH) {
        hoveredCard = i;
      }
    }
  }

  // (tooltip is drawn later to ensure it's on top)

  // draw sea animals
  textAlign(LEFT, TOP);
  textSize(14);
  fill(0);
  text('Sea Animals (one-time each):', seaX, seaY - 30);

  // whale
  let whaleW = dispTileW;
  let whaleH = Math.floor(whaleW * (sheetTileH / sheetTileW));
  let wy = seaY;
  // (sea animal descriptions removed per user request)
  // draw whale image
  if (!seaUsed.whale) {
    image(seaSprites.whale, seaX, wy, whaleW, whaleH);
  } else {
    tint(200, 200);
    image(seaSprites.whale, seaX, wy, whaleW, whaleH);
    noTint();
  }
  stroke(0);
  noFill();
  rect(seaX - 6, wy - 6, whaleW + 12, whaleH + 12, 8);
  if (seaMode === 'whale') {
    noFill();
    stroke(40, 180, 40);
    strokeWeight(3);
    rect(seaX - 6, wy - 6, whaleW + 12, whaleH + 12, 8);
  }
  // reset text alignment for subsequent UI elements
  textAlign(LEFT, TOP);

  // shark
  let sy = wy + whaleH + 18;
  // (sea animal descriptions removed per user request)
  // draw shark image
  if (!seaUsed.shark) {
    image(seaSprites.shark, seaX, sy, whaleW, whaleH);
  } else {
    tint(200, 200);
    image(seaSprites.shark, seaX, sy, whaleW, whaleH);
    noTint();
  }
  stroke(0);
  noFill();
  rect(seaX - 6, sy - 6, whaleW + 12, whaleH + 12, 8);
  if (seaMode === 'shark') {
    noFill();
    stroke(40, 180, 40);
    strokeWeight(3);
    rect(seaX - 6, sy - 6, whaleW + 12, whaleH + 12, 8);
  }
  // reset alignment after drawing
  textAlign(LEFT, TOP);

  // message
  fill(20);
  textSize(16);
  textAlign(LEFT, TOP);
  // position the message below the grid or below the sea panel when collapsed
  let messageY = gridY + ROWS * (dispTileH + spacing) + 20;
  if (seaOrientation === 'below') {
    const bottomSea = sy + whaleH + 12;
    messageY = bottomSea + 20;
  }
  text(message, gridX, messageY);

  // tooltip rendering for hovered card (drawn last so it appears above other elements)
  if (typeof hoveredCard !== 'undefined' && hoveredCard !== -1 && grid[hoveredCard] && grid[hoveredCard].length > 0 && !gameOver) {
    const cid = grid[hoveredCard][grid[hoveredCard].length - 1];
    const desc = cardDefs[cid].desc || 'No ability';
    const cx = gridX + (hoveredCard % COLS) * (dispTileW + spacing);
    const cy = gridY + Math.floor(hoveredCard / COLS) * (dispTileH + spacing);
    drawTooltip(cx + dispTileW + 12, cy, desc);
  }

  // game over overlay
  if (gameOver) {
    fill(0, 180);
    rect(0, 0, width, height);
    fill(255);
    textSize(28);
    textAlign(CENTER, CENTER);
    text(message, width / 2, height / 2 - 20);
    textSize(16);
    text('Click Restart to play again.', width / 2, height / 2 + 30);
  }
}

// --- Ability & game helper functions ---
function canEat(fromIdx, toIdx, ignoreNextRules = false) {
  if (fromIdx < 0 || toIdx < 0) return { ok: false, msg: 'Invalid selection' };
  if (grid[fromIdx].length === 0) return { ok: false, msg: 'No predator selected' };
  if (grid[toIdx].length === 0) return { ok: false, msg: 'No prey at target' };
  // cannot eat onto a non-landable tile (Y spots are pass-through only)
  if (!isLandable(toIdx)) return { ok: false, msg: 'Cannot eat onto a non-landable tile.' };
  const predId = grid[fromIdx][grid[fromIdx].length - 1];
  const preyId = grid[toIdx][grid[toIdx].length - 1];
  const predVal = cardDefs[predId].value;
  const preyVal = cardDefs[preyId].value;
  if (preyVal >= predVal) return { ok: false, msg: 'Prey must be smaller than predator' };
  if (polarBearSkip && predId === 15) return { ok: false, msg: 'Polar Bear cannot eat next turn' };

  const ax = fromIdx % COLS, ay = Math.floor(fromIdx / COLS);
  const bx = toIdx % COLS, by = Math.floor(toIdx / COLS);
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);

  // movement rules depending on pending next-turn effects
  if (!ignoreNextRules && pendingNext) {
    if (pendingNext === 'lion') {
      if (predVal - preyVal !== 1) return { ok: false, msg: 'Lion requires prey value exactly 1 less.' };
    }
    if (pendingNext === 'fox') {
      if (!(dx === 1 && dy === 1)) return { ok: false, msg: 'Fox requires diagonal move of 1 to eat.' };
    }
    if (pendingNext === 'lynx') {
      // must jump exactly two orthogonal and there must be an animal in the middle cell
      if (!((dx === 2 && dy === 0) || (dx === 0 && dy === 2))) return { ok: false, msg: 'Lynx requires a jump over one animal (2 spaces orthogonal).' };
      const midX = ax + (bx > ax ? 1 : -1);
      const midY = ay + (by > ay ? 1 : -1);
      if (midX < 0 || midX >= COLS || midY < 0 || midY >= ROWS) return { ok: false, msg: 'Lynx jump out of bounds.' };
      const midIdx = midY * COLS + midX;
      if (!grid[midIdx] || grid[midIdx].length === 0) return { ok: false, msg: 'Lynx jump requires an animal to jump over.' };
    }
    if (pendingNext === 'tiger') {
      // Tiger must move exactly two spaces orthogonally (no diagonal)
      if (!((dx === 2 && dy === 0) || (dx === 0 && dy === 2))) return { ok: false, msg: 'Tiger requires moving two spaces orthogonally to eat.' };
    }
    // gator does not restrict movement but does change stacking
  } else {
    // normal: must be adjacent orthogonally
    if (dx + dy !== 1) return { ok: false, msg: 'Prey must be adjacent (orthogonal).' };
  }

  // value difference check (except Lion handled above)
  if (!(predVal - preyVal >= 1 && predVal - preyVal <= 3)) return { ok: false, msg: 'Predator may only eat prey 1–3 values lower.' };

  const useGator = (!ignoreNextRules && pendingNext === 'gator');
  return { ok: true, msg: 'OK', useGator };
}

function performEat(fromIdx, toIdx, options = { useGator: false }) {
  // snapshot state before performing an eat so it can be undone
  recordState('eat');
  const preyStack = grid[toIdx].slice();
  const predStack = grid[fromIdx].slice();
  let resultIdx = -1;
    if (options.useGator) {
      grid[fromIdx] = preyStack.concat(predStack);
      grid[toIdx] = [];
      resultIdx = fromIdx;
    } else {
      grid[toIdx] = preyStack.concat(predStack);
      grid[fromIdx] = [];
      resultIdx = toIdx;
  }
  // record which index just performed an eat so abilities that should only trigger for eaters can check
  lastEaterIndex = resultIdx;
  return resultIdx;
}

// Centralized raccoon trigger helper: if a raccoon was pending BEFORE an eat
// and the eat was exactly 1 value lower, either queue the raccoon discard
// to run after the current actionMode completes or start it immediately.
function maybeTriggerRaccoon(prePendingRaccoon, predVal, preyVal) {
  if (!prePendingRaccoon) return;
  if (predVal - preyVal === 1) {
    // Always start the raccoon discard action (we'll queue the predator ability to run after).
    actionMode = { type: 'raccoonDiscard' };
    message = 'Raccoon triggered: choose an UNSTACKED animal to discard.';
  }
}

// Centralized post-eat handler. Returns true if caller should return immediately
// (because raccoon was started or predator was queued), false if predator
// ability has been executed and caller should continue normal completion.
function handlePostEat(newIdx, prePendingNext, prePendingRaccoon, prePolarBearSkip, predVal, preyVal) {
  console.log('[handlePostEat] newIdx=', newIdx,
    'prePendingNext=', prePendingNext,
    'prePendingRaccoon=', prePendingRaccoon,
    'prePolarBearSkip=', prePolarBearSkip,
    'predVal=', predVal,
    'preyVal=', preyVal,
    'diff=', (predVal - preyVal),
    'pendingRaccoonTurns=', pendingRaccoonTurns,
    'queuedRaccoonDiscard=', queuedRaccoonDiscard,
    'actionMode=', actionMode ? actionMode.type : null,
    'lastEaterIndex=', lastEaterIndex,
    'lastEatDiff=', lastEatDiff);
  // record the last eat diff for end-of-turn checks
  lastEatDiff = (predVal - preyVal);

  // consume pre-turn flags that applied BEFORE this eat (except raccoon — it remains active for the whole turn
  // until a matching eat occurs or the turn ends)
  if (prePendingNext) pendingNext = null;
  if (prePolarBearSkip) polarBearSkip = false;

  // If raccoon was pending BEFORE this eat and this eat is exactly -1, trigger raccoon now
  if (prePendingRaccoon && (predVal - preyVal === 1)) {
    // consume the raccoon effect for this turn
    pendingRaccoonTurns = 0;
    // If we're currently resolving another ability, queue the raccoon discard; otherwise start it now.
    if (actionMode) {
      queuedRaccoonDiscard = true;
      queuedPredatorAfterRaccoon = newIdx;
      console.log('[handlePostEat] raccoon would trigger but actionMode active; queuedRaccoonDiscard=TRUE, queuedPredatorAfterRaccoon=', queuedPredatorAfterRaccoon);
    } else {
      actionMode = { type: 'raccoonDiscard' };
      message = 'Raccoon triggered: choose an UNSTACKED animal to discard.';
      queuedPredatorAfterRaccoon = newIdx;
      console.log('[handlePostEat] raccoon started immediately; queuedPredatorAfterRaccoon=', queuedPredatorAfterRaccoon);
    }
    return true;
  }

  // If raccoon was queued earlier (queuedRaccoonDiscard true), defer predator ability
  if (queuedRaccoonDiscard) {
    queuedPredatorAfterRaccoon = newIdx;
    console.log('[handlePostEat] queuedRaccoonDiscard already set; deferring predator ability for newIdx=', newIdx);
    return true;
  }

  // Otherwise run predator ability now
  runAbilityAt(newIdx);
  return false;
}

function getLayoutPattern(layoutId) {
  // returns a row-major boolean array of length ROWS*COLS marking which cells should be filled
  const patterns = {
    '1': [
      // default: preserve original 4x4 layout on the left side of a 5x4 grid
      true, true, true, true, false,
      true, true, true, true, false,
      true, true, true, true, false,
      true, true, true, true, false
    ],
    '2': [
      // zig
      true, true, false, false, false,
      true, true, true, true, false,
      true, true, true, true, false,
      false, false, true, true, false
    ],
    '3': [
      // circle
      false, true, true, true, false,
      true, true, true, true, true,
      true, true, true, true, true,
      false, true, true, true, false
    ],
    '4': [
      // castle
      true, false, true, false, true,
      true, true, true, true, true,
      true, true, true, true, true,
      true, false, true, false, true
    ],
    '5': [
      // columns
      true, true, true, true, true,
      true, false, true, false, true,
      true, false, true, false, true,
      true, true, true, true, true
    ],
    '6': [
      // tower
      false, true, true, true, false,
      false, true, true, true, false,
      true, true, true, true, true,
      true, true, true, true, true
    ],
    '7': [
      // right space
      false, true, true, true, true,
      true, true, true, false, true,
      true, true, true, false, true,
      false, true, true, true, true
    ]
  };
  return patterns[layoutId] || patterns['1'];
}

function isLandable(i) {
  return !!layoutPattern[i];
}

function runAbilityAt(predIdx) {
  if (predIdx < 0) return;
  if (!grid[predIdx] || grid[predIdx].length === 0) return;
  const topId = grid[predIdx][grid[predIdx].length - 1];

  // Only activate "next-turn" abilities when the card actually performed the eat.
  // This prevents cards (like Lynx) from setting pendingNext when they were the prey.
  const nextAbilities = new Set([9, 10, 12, 13, 14]); // fox, lynx, tiger, gator, lion
  if (nextAbilities.has(topId)) {
    if (lastEaterIndex !== predIdx) {
      // do not activate next-turn ability if this card did not just eat
      lastEaterIndex = -1;
      return;
    }
  }

  runAbilityFor(topId, predIdx);
  lastEaterIndex = -1;
}

function runAbilityFor(cardId, cardIndex) {
  // set messages and interactive modes based on card (refactored via helpers)
  const setAction = (mode, msg) => { actionMode = mode; message = msg; };
  switch (cardId) {
    case 0:
      message = 'Plant has no ability.';
      break;
    case 1:
      setAction({ type: 'moveOne', state: 'chooseSrc', maxDist: 3 }, 'Ant ability: choose an animal to move up to 3 spaces.');
      break;
    case 2:
      setAction({ type: 'spider', state: 'chooseSrc', movesRemaining: 2 }, 'Spider: choose 2 animals to move 1 space each.');
      break;
    case 3:
      if (!hasMoveForMouse(2)) message = 'No valid moves; ability ignored.';
      else setAction({ type: 'moveOne', state: 'chooseSrc', maxDist: 2 }, 'Mouse ability: choose an animal to move 1–2 spaces.');
      break;
    case 4:
      if (anyUnstacked()) setAction({ type: 'lizardDiscard' }, 'Lizard: choose an UNSTACKED animal to remove.');
      else message = 'Lizard had no unstacked animals; ability ignored.';
      break;
    case 5:
      setAction({ type: 'moveOne', state: 'chooseSrc', maxDist: 2 }, 'Rat: choose an animal to move 2 spaces.');
      break;
    case 6:
      setAction({ type: 'batMove', state: 'chooseDest', src: cardIndex }, 'Bat: choose an OPEN destination (cannot stack).');
      break;
    case 7:
      if (countNonEmpty() < 2) message = 'Snake has no two cards to swap; ability ignored.';
      else setAction({ type: 'snakeSwap', state: 'chooseA' }, 'Snake: choose two cards to swap.');
      break;
    case 8:
      pendingRaccoonQueued = true;
      message = 'Raccoon activated: on your next turn, if you eat an animal exactly 1 lower, discard an unstacked animal.';
      break;
    case 9:
      pendingNextQueued = 'fox';
      message = 'Fox: next predator must move diagonally 1 to eat.';
      break;
    case 10:
      pendingNextQueued = 'lynx';
      message = 'Lynx: next predator must jump one card to eat (2 spaces orthogonal).';
      break;
    case 11: {
      const neighbors = getWolfNeighbors(cardIndex);
      if (neighbors.length === 0) {
        message = 'Wolf has no adjacent empty space to move.';
      } else if (neighbors.length === 1) {
        recordState('wolf-auto-move');
        const dest = neighbors[0];
        grid[dest] = grid[cardIndex].slice();
        grid[cardIndex] = [];
        message = 'Wolf moved its stack.';
      } else {
        setAction({ type: 'wolfMove', state: 'chooseDest', src: cardIndex }, 'Wolf: choose an adjacent EMPTY space to move its entire stack.');
      }
      break;
    }
    case 12:
      pendingNextQueued = 'tiger';
      message = 'Tiger: next predator may move two spaces (path allowed) to reach prey.';
      break;
    case 13:
      pendingNextQueued = 'gator';
      message = 'Gator: next eat will reverse stacking (prey moves under eater).';
      break;
    case 14:
      pendingNextQueued = 'lion';
      message = 'Lion: next predator must eat a prey valued exactly 1 less.';
      break;
    case 15:
      polarBearSkip = true;
      message = 'Polar Bear used: it cannot eat on your next turn.';
      break;
    default:
      message = 'Unknown ability.';
  }
}

function handleActionClick(i) {
  if (!actionMode) return;
  const t = actionMode.type;
  if (t === 'moveOne') {
    if (actionMode.state === 'chooseSrc') {
      if (grid[i].length === 0) { message = 'Choose a non-empty source.'; return; }
      actionMode.src = i; actionMode.state = 'chooseDest'; message = 'Choose destination.'; return;
    }
    if (actionMode.state === 'chooseDest') {
      const src = actionMode.src; const dx = Math.abs((src % COLS) - (i % COLS)); const dy = Math.abs(Math.floor(src / COLS) - Math.floor(i / COLS));
      const dist = dx + dy;
      if (dist < 1 || dist > actionMode.maxDist) { message = 'Destination out of range.'; return; }
      // If moving multiple spaces, rules require landing on an open space
      if (dist > 1 && grid[i].length > 0) { message = 'Destination must be empty for multi-space moves.'; return; }

      // Destination must be landable
      if (!isLandable(i)) { message = 'Destination must be a landable tile.'; return; }

      // If this is a single-space move onto an occupied tile, treat it as an EAT
      if (dist === 1 && grid[i].length > 0) {
        // capture pre-eat flags
        const prePendingNext = pendingNext;
        const prePendingRaccoon = (pendingRaccoonTurns === 1);
        const prePolarBearSkip = polarBearSkip;

        // validate eat according to rules
        const can = canEat(src, i, false);
        if (!can.ok) { message = can.msg; return; }

        // compute pred/prey values for raccoon logic
        const predId = grid[src][grid[src].length - 1];
        const preyId = grid[i][grid[i].length - 1];
        const predVal = cardDefs[predId].value;
        const preyVal = cardDefs[preyId].value;

        // perform eat (respect gator stacking)
        const newIdx = performEat(src, i, { useGator: can.useGator });

        // clear the current ability mode (we're replacing the moveOne flow)
        actionMode = null;

        // central post-eat handling (raccoon first; predator deferred if needed)
        const early = handlePostEat(newIdx, prePendingNext, prePendingRaccoon, prePolarBearSkip, predVal, preyVal);
        if (early) return;

        // If no ability was set by the predator (or raccoon), finish the ability now.
        if (!actionMode) {
          message = 'Ability used.';
          checkEnd();
        }
        return;
      }

      // Otherwise this is a non-eating move (empty destination) — move stack (allow stacking only when dest empty)
      recordState('move');
      grid[i] = grid[src].slice(); grid[src] = [];
      message = 'Ability used.';
      actionMode = null;
      if (queuedRaccoonDiscard) { queuedRaccoonDiscard = false; actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; return; }
      checkEnd(); return;
    }
  }
  if (t === 'spider') {
    // Spider moves two animals, one space each. Flow: chooseSrc -> chooseDest, repeat twice.
    if (actionMode.state === 'chooseSrc') {
      if (grid[i].length === 0) { message = 'Choose a non-empty source.'; return; }
      actionMode.src = i;
      actionMode.state = 'chooseDest';
      message = 'Choose adjacent destination for selected animal.';
      return;
    } else if (actionMode.state === 'chooseDest') {
      const src = actionMode.src;
      const dx = Math.abs((src % COLS) - (i % COLS));
      const dy = Math.abs(Math.floor(src / COLS) - Math.floor(i / COLS));
      if (dx + dy !== 1) { message = 'Destination must be adjacent.'; return; }
      // Spider moves animals; destination must be empty (no stacking) and be landable
      if (!isLandable(i)) { message = 'Destination must be a landable tile.'; return; }
      if (grid[i].length > 0) { message = 'Destination must be empty for Spider.'; return; }
      recordState('spider-move');
      grid[i] = grid[src].slice();
      grid[src] = [];
      actionMode.movesRemaining = (actionMode.movesRemaining || 1) - 1;
      if (actionMode.movesRemaining > 0) {
        actionMode.state = 'chooseSrc';
        actionMode.src = null;
        message = 'One move done. Choose another animal to move (1 remaining).';
        return;
      } else {
        actionMode = null;
        message = 'Spider moved two animals. Ability complete.';
        if (queuedRaccoonDiscard) { queuedRaccoonDiscard = false; actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; return; }
        checkEnd();
        return;
      }
    }
  }
  if (t === 'lizardDiscard') {
    if (grid[i].length !== 1) { message = 'You must choose an UNSTACKED animal (single card).'; return; }
    recordState('lizard-discard');
    grid[i] = [];
    actionMode = null; message = 'Lizard discarded one unstacked animal.';
    if (queuedRaccoonDiscard) { queuedRaccoonDiscard = false; actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; return; }
    checkEnd(); return;
  }
  if (t === 'raccoonDiscard') {
    if (grid[i].length !== 1) { message = 'You must choose an UNSTACKED animal (single card).'; return; }
    recordState('raccoon-discard');
    console.log('[raccoonDiscard] discarding at index', i, 'queuedPredatorAfterRaccoon=', queuedPredatorAfterRaccoon);
    grid[i] = [];
    actionMode = null;
    message = 'Raccoon discarded one unstacked animal.';
    // clear the remembered last-eat diff so Raccoon won't re-trigger
    lastEatDiff = null;
    // If a predator ability was deferred until after raccoon, run it now.
    if (queuedPredatorAfterRaccoon !== -1) {
      const idx = queuedPredatorAfterRaccoon;
      queuedPredatorAfterRaccoon = -1;
      runAbilityAt(idx);
      if (!actionMode) { message = 'Ability used.'; checkEnd(); }
      return;
    }
    checkEnd(); return;
  }
  if (t === 'snakeSwap') {
    if (actionMode.state === 'chooseA') { actionMode.a = i; actionMode.state = 'chooseB'; message = 'Choose second card to swap.'; return; }
    if (actionMode.state === 'chooseB') { const a = actionMode.a; const b = i; recordState('snake-swap'); const tmp = grid[a]; grid[a] = grid[b]; grid[b] = tmp; actionMode = null; message = 'Cards swapped.'; if (queuedRaccoonDiscard) { queuedRaccoonDiscard = false; actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; return; } checkEnd(); return; }
  }
  if (t === 'batMove') {
    const src = actionMode.src;
    if (i === src) { message = 'Destination must be different.'; return; }
    if (grid[i].length > 0) { message = 'Bat must move to an empty space.'; return; }
    if (!isLandable(i)) { message = 'Destination must be a landable tile.'; return; }
    recordState('bat-move');
    grid[i] = grid[src].slice(); grid[src] = [];
    actionMode = null; message = 'Bat moved.'; if (queuedRaccoonDiscard) { queuedRaccoonDiscard = false; actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; return; } checkEnd(); return;
  }
  if (t === 'wolfMove') {
    const src = actionMode.src;
    const dx = Math.abs((src % COLS) - (i % COLS)); const dy = Math.abs(Math.floor(src / COLS) - Math.floor(i / COLS));
    if (dx + dy !== 1) { message = 'Wolf must move 1 space.'; return; }
    if (!isLandable(i)) { message = 'Destination is outside the playable area.'; return; }
    if (grid[i].length > 0) { message = 'Destination must be empty for Wolf.'; return; }
    recordState('wolf-move');
    grid[i] = grid[src].slice(); grid[src] = [];
    actionMode = null; message = 'Wolf moved its stack.'; if (queuedRaccoonDiscard) { queuedRaccoonDiscard = false; actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; return; } checkEnd(); return;
  }
}

function drawTooltip(x, y, textStr) {
  push();
  textSize(14);
  const w = 260; const h = 60;
  fill(255, 245);
  stroke(0);
  rect(x, y, w, h, 6);
  fill(10);
  noStroke();
  textAlign(LEFT, TOP);
  textWrap(WORD);
  text(textStr, x + 8, y + 8, w - 16, h - 16);
  pop();
}

function mousePressed() {
  // use pointerPressed with p5 mouse coords
  pointerPressed(mouseX, mouseY);
}

function pointerPressed(px, py) {
  if (gameOver) return;

  // detect clicking sea animals
  let whaleW = dispTileW;
  let whaleH = Math.floor(whaleW * (sheetTileH / sheetTileW));
  let wy = seaY;
  let sy = wy + whaleH + 18;

  if (px >= seaX - 6 && px <= seaX - 6 + whaleW + 12 && py >= wy - 6 && py <= wy - 6 + whaleH + 12) {
    if (!seaUsed.whale) {
      // Selecting a sea animal cancels any currently active ability resolution
      if (actionMode || queuedRaccoonDiscard || selected !== -1) {
        recordState('cancel-ability');
        actionMode = null;
        queuedRaccoonDiscard = false;
        selected = -1;
      }
      seaMode = seaMode === 'whale' ? null : 'whale';
      seaSource = -1;
      message = seaMode === 'whale' ? 'Whale selected: click an animal to move, then an empty space as destination.' : 'Cancelled sea action.';
    }
    return;
  }

  if (px >= seaX - 6 && px <= seaX - 6 + whaleW + 12 && py >= sy - 6 && py <= sy - 6 + whaleH + 12) {
    if (!seaUsed.shark) {
      // Selecting a sea animal cancels any currently active ability resolution
      if (actionMode || queuedRaccoonDiscard || selected !== -1) {
        recordState('cancel-ability');
        actionMode = null;
        queuedRaccoonDiscard = false;
        selected = -1;
      }
      seaMode = seaMode === 'shark' ? null : 'shark';
      seaSource = -1;
      message = seaMode === 'shark' ? 'Shark selected: click a predator to move 1 space and eat any smaller prey.' : 'Cancelled sea action.';
    }
    return;
  }

  // detect grid cell clicked
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let i = r * COLS + c;
      let x = gridX + c * (dispTileW + spacing);
      let y = gridY + r * (dispTileH + spacing);
      if (px >= x && px <= x + dispTileW && py >= y && py <= y + dispTileH) {
        handleGridClick(i);
        return;
      }
    }
  }
}

function handleGridClick(i) {
  // if an ability resolution is waiting, handle that first
  if (actionMode) {
    handleActionClick(i);
    return;
  }

  // Defensive: cancel sea actions if that sea animal has already been used
  if (seaMode === 'whale' && seaUsed.whale) {
    seaMode = null; seaSource = -1; message = 'Whale has already been used.'; return;
  }
  if ((seaMode === 'shark' || seaMode === 'shark_eat') && seaUsed.shark) {
    seaMode = null; seaSource = -1; message = 'Shark has already been used.'; return;
  }

  // Whale: pick source then any empty destination
  if (seaMode === 'whale') {
    if (seaSource === -1) {
      if (grid[i].length === 0) {
        message = 'Select a non-empty animal to move with the Whale.';
      } else {
        seaSource = i;
        const stackSize = grid[i].length;
        message = 'Whale: selected a ' + stackSize + '-card stack. Now click an EMPTY destination tile.';
      }
      return;
    } else {
      if (i === seaSource) { message = 'Destination must be different.'; return; }
      if (grid[i].length > 0) { message = 'Destination must be empty for Whale.'; return; }
      // Move the entire stack from the source to the empty destination (stacks move together)
      recordState('whale-move');
      grid[i] = grid[seaSource].slice();
      grid[seaSource] = [];
      seaUsed.whale = true;
      seaMode = null; seaSource = -1;
      message = 'Whale moved an animal.';
      // Whale is usable at any time during a turn; update end-of-turn checks.
      checkEnd();
      return;
    }
  }

  // Shark: pick predator then an adjacent prey; shark ignores next-turn constraints
  if (seaMode === 'shark') {
    // Steps: select predator, then select an adjacent EMPTY tile to move it, then select adjacent prey to eat (any smaller prey).
    if (seaSource === -1) {
      if (grid[i].length === 0) { message = 'Select a non-empty predator for Shark.'; return; }
      seaSource = i; const stackSize = grid[i].length;
      message = 'Shark: selected predator (stack of ' + stackSize + '). Click an ADJACENT EMPTY tile to move this animal, or click an adjacent prey to eat directly.';
      return;
    } else if (seaMode === 'shark') {
      // pre-eat flags
      const prePendingNext = pendingNext;
      const prePendingRaccoon = (pendingRaccoonTurns === 1);
      const prePolarBearSkip = polarBearSkip;

      const predId = grid[seaSource][grid[seaSource].length - 1];
      const predVal = cardDefs[predId].value;
      const ax = seaSource % COLS, ay = Math.floor(seaSource / COLS);
      const bx = i % COLS, by = Math.floor(i / COLS);
      const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);

      // if destination is empty and adjacent, move predator there first
      if (grid[i].length === 0) {
        if (dx + dy !== 1) { message = 'Destination must be adjacent and empty.'; return; }
        if (!isLandable(i)) { message = 'Destination must be a landable tile.'; return; }
        recordState('shark-move');
        grid[i] = grid[seaSource].slice();
        grid[seaSource] = [];
        seaSource = i;
        seaMode = 'shark_eat';
        message = 'Shark moved predator. Now click an ADJACENT prey to eat (any smaller prey).';
        return;
      }

      // otherwise, attempt a direct eat (adjacent prey)
      if (dx + dy !== 1) { message = 'Prey must be adjacent to the predator.'; return; }
      const preyId = grid[i][grid[i].length - 1];
      const preyVal = cardDefs[preyId].value;
      if (preyVal >= predVal) { message = 'Prey must be smaller than predator.'; return; }

      // perform eat ignoring the usual value-difference limit (shark allows any smaller prey)
      const newIdx = performEat(seaSource, i, { useGator: false });
      seaUsed.shark = true; seaMode = null; seaSource = -1;
      message = 'Shark used to help an animal eat. Continue.';

      // central post-eat handling (raccoon first; predator deferred if needed)
      const early = handlePostEat(newIdx, prePendingNext, prePendingRaccoon, prePolarBearSkip, predVal, preyVal);
      if (early) { checkEnd(); return; }

      checkEnd();
      return;
    }
  }

  // After moving with the Shark, eat step
  if (seaMode === 'shark_eat') {
    if (seaSource === -1) { seaMode = null; message = 'Shark cancelled.'; return; }
    const predId = grid[seaSource][grid[seaSource].length - 1];
    const predVal = cardDefs[predId].value;
    const ax = seaSource % COLS, ay = Math.floor(seaSource / COLS);
    const bx = i % COLS, by = Math.floor(i / COLS);
    const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    if (dx + dy !== 1) { message = 'Prey must be adjacent to the moved predator.'; return; }
    if (grid[i].length === 0) { message = 'Select a prey to eat.'; return; }
    const preyId = grid[i][grid[i].length - 1];
    const preyVal = cardDefs[preyId].value;
    if (preyVal >= predVal) { message = 'Prey must be smaller than predator.'; return; }

    // pre flags
    const prePendingNext = pendingNext;
    const prePendingRaccoon = (pendingRaccoonTurns === 1);
    const prePolarBearSkip = polarBearSkip;

    const newIdx = performEat(seaSource, i, { useGator: false });
    seaUsed.shark = true; seaMode = null; seaSource = -1;
    message = 'Shark used to help an animal eat. Continue.';

    // central post-eat handling (raccoon first; predator deferred if needed)
    const early2 = handlePostEat(newIdx, prePendingNext, prePendingRaccoon, prePolarBearSkip, predVal, preyVal);
    if (early2) { checkEnd(); return; }

    checkEnd();
    return;
  }

  // Normal play: select predator then prey
  if (selected === -1) {
    if (grid[i].length === 0) { message = 'Select a non-empty predator to begin.'; return; }
    // snapshot previous state so Undo can revert activation + selection
    recordState('select');
    // If a next-turn ability was queued from the previous eat, activate it now
    if (pendingNextQueued && !actionMode && !seaMode) {
      pendingNext = pendingNextQueued;
      pendingNextQueued = null;
      message = 'Next-turn ability active: ' + pendingNext + '.';
    }
    selected = i; message = 'Predator selected: click a prey to attempt to eat.'; return;
  }

  // attempt eat with the selected predator
  if (i === selected) { recordState('deselect'); selected = -1; message = 'Selection cleared.'; return; }
  if (grid[i].length === 0) { message = 'There is no prey here.'; return; }

  // capture any pending flags that apply BEFORE this eat (they should be consumed by this eat)
  const prePendingNext = pendingNext;
  const prePendingRaccoon = (pendingRaccoonTurns === 1);
  const prePolarBearSkip = polarBearSkip;

  const can = canEat(selected, i, false);
  if (!can.ok) { message = can.msg; return; }
  // compute pred/prey values before the eat (we'll need them for raccoon logic)
  const predId = grid[selected][grid[selected].length - 1];
  const preyId = grid[i][grid[i].length - 1];
  const predVal = cardDefs[predId].value;
  const preyVal = cardDefs[preyId].value;
  const diff = predVal - preyVal;

  // perform eat; can.useGator toggles reversed stacking
  const newIdx = performEat(selected, i, { useGator: can.useGator });

  // central post-eat handling (raccoon first; predator deferred if needed)
  const early = handlePostEat(newIdx, prePendingNext, prePendingRaccoon, prePolarBearSkip, predVal, preyVal);
  if (early) { selected = -1; checkEnd(); return; }

  selected = -1;
  checkEnd();
}

// (performEat with options defined earlier)

function isAdjacent(a, b) {
  let ax = a % COLS;
  let ay = Math.floor(a / COLS);
  let bx = b % COLS;
  let by = Math.floor(b / COLS);
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  return (dx + dy === 1);
}

function getOrthogonalNeighbors(i) {
  const res = [];
  const x = i % COLS, y = Math.floor(i / COLS);
  if (x > 0) res.push(i - 1);
  if (x < COLS - 1) res.push(i + 1);
  if (y > 0) res.push(i - COLS);
  if (y < ROWS - 1) res.push(i + COLS);
  return res;
}

function anyUnstacked() {
  for (let gi = 0; gi < grid.length; gi++) if (grid[gi].length === 1) return true;
  return false;
}

function countNonEmpty() {
  let c = 0;
  for (let gi = 0; gi < grid.length; gi++) if (grid[gi].length > 0) c++;
  return c;
}

function hasMoveForMouse(maxDist) {
  for (let src = 0; src < grid.length; src++) {
    if (grid[src].length === 0) continue;
    const sx = src % COLS, sy = Math.floor(src / COLS);
    for (let dest = 0; dest < grid.length; dest++) {
      if (dest === src) continue;
      const dx = Math.abs(sx - (dest % COLS));
      const dy = Math.abs(sy - Math.floor(dest / COLS));
      const dist = dx + dy;
      if (dist < 1 || dist > maxDist) continue;
      if (!isLandable(dest)) continue;
      if (dist > 1) {
        if (grid[dest].length === 0) return true;
        continue;
      }
      // dist === 1
      if (grid[dest].length === 0) return true;
      const can = canEat(src, dest, false);
      if (can.ok) return true;
    }
  }
  return false;
}

function getWolfNeighbors(idx) {
  const x = idx % COLS, y = Math.floor(idx / COLS);
  const deltas = [ [-1,0], [1,0], [0,-1], [0,1] ];
  const out = [];
  for (const [dr,dc] of deltas) {
    const nr = y + dr, nc = x + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    const nidx = nr * COLS + nc;
    if (!isLandable(nidx)) continue;
    if (grid[nidx] && grid[nidx].length > 0) continue;
    out.push(nidx);
  }
  return out;
}

// Return true if using the Whale (moving any non-empty stack to any empty landable tile)
// could create at least one legal eat (respecting normal canEat rules).
function canUseWhaleToCreateEat() {
  if (seaUsed.whale) return false;
  for (let s = 0; s < grid.length; s++) {
    if (grid[s].length === 0) continue;
    for (let d = 0; d < grid.length; d++) {
      if (d === s) continue;
      if (!isLandable(d)) continue;
      if (grid[d].length > 0) continue;
      // simulate the move
      const backup = grid;
      grid = backup.map(arr => arr.slice());
      grid[d] = backup[s].slice();
      grid[s] = [];
      const possible = hasNormalMove();
      grid = backup;
      if (possible) return true;
    }
  }
  return false;
}

// Return true if using the Shark (moving a predator 1 space or direct-eating) could create an eat.
function canUseSharkToCreateEat() {
  if (seaUsed.shark) return false;
  for (let s = 0; s < grid.length; s++) {
    if (grid[s].length === 0) continue;
    const predId = grid[s][grid[s].length - 1];
    const predVal = cardDefs[predId].value;
    // direct eat from source (shark allows any smaller prey)
    const neigh = getOrthogonalNeighbors(s);
    for (const j of neigh) {
      if (grid[j].length === 0) continue;
      const preyId = grid[j][grid[j].length - 1];
      const preyVal = cardDefs[preyId].value;
      if (preyVal < predVal) return true;
    }
    // move then eat: move predator to an adjacent empty landable tile then check adjacent prey
    for (const d of neigh) {
      if (!isLandable(d)) continue;
      if (grid[d].length > 0) continue;
      const neigh2 = getOrthogonalNeighbors(d);
      for (const k of neigh2) {
        if (grid[k].length === 0) continue;
        const preyId2 = grid[k][grid[k].length - 1];
        const preyVal2 = cardDefs[preyId2].value;
        if (preyVal2 < predVal) return true;
      }
    }
  }
  return false;
}

function checkEnd() {
  // If an interactive ability is currently being resolved, defer end-of-turn checks
  if (actionMode) return;

  // Raccoon: if raccoon is active this turn and the most recent eat was exactly 1 less,
  // ensure Raccoon fires first by starting the discard now (if not already queued).
  if (pendingRaccoonTurns === 1 && lastEatDiff === 1 && !queuedRaccoonDiscard) {
    console.log('[checkEnd] starting raccoon discard from checkEnd: pendingRaccoonTurns=', pendingRaccoonTurns, 'lastEatDiff=', lastEatDiff, 'queuedRaccoonDiscard=', queuedRaccoonDiscard, 'lastEaterIndex=', lastEaterIndex);
    actionMode = { type: 'raccoonDiscard' };
    message = 'Raccoon triggered: choose an UNSTACKED animal to discard.';
    if (queuedPredatorAfterRaccoon === -1 && lastEaterIndex !== -1) queuedPredatorAfterRaccoon = lastEaterIndex;
    return;
  }

  // If a raccoon discard was queued to run after an ability, start it now instead of ending
  if (queuedRaccoonDiscard) {
    queuedRaccoonDiscard = false;
    actionMode = { type: 'raccoonDiscard' };
    message = 'Raccoon triggered: choose an UNSTACKED animal to discard.';
    return;
  }

  // If a sea action is mid-selection, don't end the game
  if (seaMode) return;
  // First: check for any actionable moves in the CURRENT turn (before committing queued next-turn effects)
  if (hasNormalMove()) return;
  if ((!seaUsed.whale && canUseWhaleToCreateEat()) || (!seaUsed.shark && canUseSharkToCreateEat())) {
    message = 'No normal moves available. You can still use a sea animal or Restart.';
    return;
  }

  // No actions left in the current turn — commit end-of-turn queued effects and advance to the next turn state
  if (pendingNextQueued) {
    pendingNext = pendingNextQueued;
    pendingNextQueued = null;
    message = 'Next-turn ability active: ' + pendingNext + '.';
  }
  // If a Raccoon was used this turn, activate it for the next turn now (queue -> turns counter)
  if (pendingRaccoonQueued) {
    pendingRaccoonTurns = 2;
    pendingRaccoonQueued = false;
  }
  if (pendingRaccoonTurns > 0) pendingRaccoonTurns--;

  // After activating queued next-turn effects, check again for possible moves in the new state
  if (hasNormalMove()) return;
  if ((!seaUsed.whale && canUseWhaleToCreateEat()) || (!seaUsed.shark && canUseSharkToCreateEat())) {
    message = 'No normal moves available. You can still use a sea animal or Restart.';
    return;
  }

  // finalize the game using the same logic as the Finish button
  finishGame();
}

function hasNormalMove() {
  // Rules-aware check: iterate all predator/prey pairs and use canEat (respects pendingNext abilities)
  for (let i = 0; i < grid.length; i++) {
    if (grid[i].length === 0) continue;
    for (let j = 0; j < grid.length; j++) {
      if (i === j) continue;
      if (grid[j].length === 0) continue;
      const can = canEat(i, j, false);
      if (can.ok) return true;
    }
  }
  return false;
}

function finishGame() {
  if (gameOver) return;
  // Count only animals on landable tiles
  let remaining = 0;
  for (let i = 0; i < grid.length; i++) {
    if (layoutPattern && layoutPattern[i]) {
      if (grid[i].length > 0) remaining++;
    } else {
      if (grid[i].length > 0) remaining++;
    }
  }

  if (remaining <= 3) {
    if (remaining === 1) {
      message = 'One Animal Left: Ecosystem Expert';
    } else if (remaining === 2) {
      message = 'Two Animals Left: Accidental Matchmaker';
    } else if (remaining === 3) {
      message = 'Three Animals Left: Island Intern';
    } else {
      message = 'You win! Remaining animals: ' + remaining;
    }
  } else {
    message = 'You lose. Remaining animals: ' + remaining;
  }
  gameOver = true;
}
