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

let layoutSelect;
let selectedLayout = '1';
let finishButton;
let layoutPattern = [];

// game state flags for card-specific abilities
let pendingNext = null; // 'fox','lynx','tiger','lion','gator' - applies to the next predator only
let pendingRaccoonTurns = 0; // when >0 counts down at end-of-turn; value==1 means raccoon effect applies this turn
let polarBearSkip = false; // when true, Polar Bear cannot be used to eat on the next turn
let actionMode = null; // interactive ability resolution state
let queuedRaccoonDiscard = false; // when true, run raccoon discard after current actionMode completes
let lastEaterIndex = -1; // index of the last eater (set by performEat) to ensure 'next' abilities only trigger for actual eaters

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
  pendingRaccoonTurns = 0;
  polarBearSkip = false;
  actionMode = null;
  queuedRaccoonDiscard = false;
  lastEaterIndex = -1;
  message = 'Click a card to select a predator. Use sea animals on the right.';
  seaUsed = { whale: false, shark: false };
  gameOver = false;

  // Reposition UI elements to account for layout/resize (keep +75px horizontal offset)
  if (restartButton) restartButton.position(pagePadding + 75, pagePadding + 25);
  if (layoutSelect) layoutSelect.position(pagePadding + 175, pagePadding + 25);
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
    finishButton.position(gridX + 75, finishY);
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
      // must jump 2 orthogonal with a card in the middle
      if (!((dx === 2 && dy === 0) || (dx === 0 && dy === 2))) return { ok: false, msg: 'Lynx requires a jump over one animal (2 spaces orthogonal).' };
      const midX = (ax + bx) / 2, midY = (ay + by) / 2;
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
  const preyStack = grid[toIdx].slice();
  const predStack = grid[fromIdx].slice();
  let resultIdx = -1;
  if (options.useGator) {
    // opposite stacking: move the eaten animal under the eater at the eater's location
    grid[fromIdx] = preyStack.concat(predStack);
    grid[toIdx] = [];
    resultIdx = fromIdx; // predator remains at original index
  } else {
    grid[toIdx] = preyStack.concat(predStack);
    grid[fromIdx] = [];
    resultIdx = toIdx; // predator ends up at prey location
  }
  // record which index just performed an eat so abilities that should only trigger for eaters can check
  lastEaterIndex = resultIdx;
  return resultIdx;
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
  // set messages and interactive modes based on card
  switch (cardId) {
    case 0: // Plant
      message = 'Plant has no ability.';
      break;
    case 1: // Ant
      actionMode = { type: 'moveOne', state: 'chooseSrc', maxDist: 3 };
      message = 'Ant ability: choose an animal to move up to 3 spaces.';
      break;
    case 2: // Spider
      actionMode = { type: 'spider', state: 'chooseSrc', movesRemaining: 2 };
      message = 'Spider: choose 2 animals to move 1 space each.';
      break;
    case 3: // Mouse
      actionMode = { type: 'moveOne', state: 'chooseSrc', maxDist: 2 };
      message = 'Mouse ability: choose an animal to move 1–2 spaces.';
      break;
    case 4: // Lizard
      actionMode = { type: 'lizardDiscard' };
      message = 'Lizard: choose an UNSTACKED animal to remove.';
      break;
    case 5: // Rat
      actionMode = { type: 'moveOne', state: 'chooseSrc', maxDist: 2 };
      message = 'Rat: choose an animal to move 2 spaces.';
      break;
    case 6: // Bat
      actionMode = { type: 'batMove', state: 'chooseDest', src: cardIndex };
      message = 'Bat: choose an OPEN destination (cannot stack).' ;
      break;
    case 7: // Snake
      actionMode = { type: 'snakeSwap', state: 'chooseA' };
      message = 'Snake: choose two cards to swap.';
      break;
    case 8: // Raccoon
      // Set to 2 so it survives through the remainder of this turn and becomes active on the next turn
      pendingRaccoonTurns = 2;
      message = 'Raccoon activated: on your next turn, if you eat an animal exactly 1 lower, discard an unstacked animal.';
      break;
    case 9: // Fox
      pendingNext = 'fox';
      message = 'Fox: next predator must move diagonally 1 to eat.';
      break;
    case 10: // Lynx
      pendingNext = 'lynx';
      message = 'Lynx: next predator must jump one card to eat (2 spaces orthogonal).';
      break;
    case 11: // Wolf
      // After the Wolf eats, it may move its entire stack 1 space. If no valid spaces, do nothing.
      const wolfSrc = cardIndex;
      const wr = Math.floor(wolfSrc / COLS), wc = wolfSrc % COLS;
      const wolfNeighbors = [];
      const deltas = [ [-1,0], [1,0], [0,-1], [0,1] ];
      for (const [dr,dc] of deltas) {
        const nr = wr + dr, nc = wc + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
        const nidx = nr * COLS + nc;
        if (!isLandable(nidx)) continue;
        wolfNeighbors.push(nidx);
      }
      if (wolfNeighbors.length === 0) {
        message = 'Wolf has no adjacent space to move.';
      } else if (wolfNeighbors.length === 1) {
        // auto-move to the only available neighbor
        const dest = wolfNeighbors[0];
        grid[dest] = grid[dest].concat(grid[wolfSrc]);
        grid[wolfSrc] = [];
        message = 'Wolf moved its stack.';
      } else {
        // multiple choices — allow the player to choose
        actionMode = { type: 'wolfMove', state: 'chooseDest', src: cardIndex };
        message = 'Wolf: choose an adjacent space to move its entire stack.';
      }
      break;
    case 12: // Tiger
      pendingNext = 'tiger';
      message = 'Tiger: next predator may move two spaces (path allowed) to reach prey.';
      break;
    case 13: // Gator
      pendingNext = 'gator';
      message = 'Gator: next eat will reverse stacking (prey moves under eater).';
      break;
    case 14: // Lion
      pendingNext = 'lion';
      message = 'Lion: next predator must eat a prey valued exactly 1 less.';
      break;
    case 15: // Polar Bear
      polarBearSkip = true;
      message = 'Polar Bear used: it cannot eat on your next turn.';
      break;
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

        // clear the one-time flags that applied BEFORE this eat (consume them)
        if (prePendingNext) pendingNext = null;
        if (prePendingRaccoon) pendingRaccoonTurns = 0;
        if (prePolarBearSkip) polarBearSkip = false;

        // clear the current ability mode (we're replacing the moveOne flow)
        actionMode = null;

        // resolve predator ability for the eater (may set a new actionMode)
        runAbilityAt(newIdx);

        // raccoon: if active before this eat and this eat was exactly -1, queue or prompt discard
        if (prePendingRaccoon && (predVal - preyVal === 1)) {
          if (actionMode) queuedRaccoonDiscard = true;
          else { actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; }
        }

        // If no ability was set by the predator (or raccoon), finish the ability now.
        if (!actionMode) {
          message = 'Ability used.';
          checkEnd();
        }
        return;
      }

      // Otherwise this is a non-eating move (empty destination) — move stack (allow stacking only when dest empty)
      grid[i] = grid[i].concat(grid[src]); grid[src] = [];
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
      grid[i] = grid[i].concat(grid[src]);
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
    grid[i] = [];
    actionMode = null; message = 'Lizard discarded one unstacked animal.';
    if (queuedRaccoonDiscard) { queuedRaccoonDiscard = false; actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; return; }
    checkEnd(); return;
  }
  if (t === 'raccoonDiscard') {
    if (grid[i].length !== 1) { message = 'You must choose an UNSTACKED animal (single card).'; return; }
    grid[i] = [];
    actionMode = null; message = 'Raccoon discarded one unstacked animal.';
    checkEnd(); return;
  }
  if (t === 'snakeSwap') {
    if (actionMode.state === 'chooseA') { actionMode.a = i; actionMode.state = 'chooseB'; message = 'Choose second card to swap.'; return; }
    if (actionMode.state === 'chooseB') { const a = actionMode.a; const b = i; const tmp = grid[a]; grid[a] = grid[b]; grid[b] = tmp; actionMode = null; message = 'Cards swapped.'; if (queuedRaccoonDiscard) { queuedRaccoonDiscard = false; actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; return; } checkEnd(); return; }
  }
  if (t === 'batMove') {
    const src = actionMode.src;
    if (i === src) { message = 'Destination must be different.'; return; }
    if (grid[i].length > 0) { message = 'Bat must move to an empty space.'; return; }
    if (!isLandable(i)) { message = 'Destination must be a landable tile.'; return; }
    grid[i] = grid[src].slice(); grid[src] = [];
    actionMode = null; message = 'Bat moved.'; if (queuedRaccoonDiscard) { queuedRaccoonDiscard = false; actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; return; } checkEnd(); return;
  }
  if (t === 'wolfMove') {
    const src = actionMode.src;
    const dx = Math.abs((src % COLS) - (i % COLS)); const dy = Math.abs(Math.floor(src / COLS) - Math.floor(i / COLS));
    if (dx + dy !== 1) { message = 'Wolf must move 1 space.'; return; }
    if (!isLandable(i)) { message = 'Destination is outside the playable area.'; return; }
    grid[i] = grid[i].concat(grid[src]); grid[src] = [];
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
  if (gameOver) return;

  // detect clicking sea animals
  let whaleW = dispTileW;
  let whaleH = Math.floor(whaleW * (sheetTileH / sheetTileW));
  let wy = seaY;
  let sy = wy + whaleH + 18;

  if (mouseX >= seaX - 6 && mouseX <= seaX - 6 + whaleW + 12 && mouseY >= wy - 6 && mouseY <= wy - 6 + whaleH + 12) {
    if (!seaUsed.whale) {
      seaMode = seaMode === 'whale' ? null : 'whale';
      seaSource = -1;
      message = seaMode === 'whale' ? 'Whale selected: click an animal to move, then an empty space as destination.' : 'Cancelled sea action.';
    }
    return;
  }

  if (mouseX >= seaX - 6 && mouseX <= seaX - 6 + whaleW + 12 && mouseY >= sy - 6 && mouseY <= sy - 6 + whaleH + 12) {
    if (!seaUsed.shark) {
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
      if (mouseX >= x && mouseX <= x + dispTileW && mouseY >= y && mouseY <= y + dispTileH) {
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
        message = 'Whale: now click an EMPTY destination tile.';
      }
      return;
    } else {
      if (i === seaSource) { message = 'Destination must be different.'; return; }
      if (grid[i].length > 0) { message = 'Destination must be empty for Whale.'; return; }
      if (!isLandable(i)) { message = 'Destination must be a landable tile.'; return; }
      // Move the entire stack from the source to the empty destination (stacks move together)
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
      seaSource = i; message = 'Shark: click an ADJACENT EMPTY tile to move this animal, or click an adjacent prey to eat directly.'; return;
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

      // clear pre-turn flags (consume flags that applied BEFORE this eat)
      if (prePendingNext) pendingNext = null;
      if (prePendingRaccoon) pendingRaccoonTurns = 0;
      if (prePolarBearSkip) polarBearSkip = false;

      // Resolve predator ability for the eater
      runAbilityAt(newIdx);

      // raccoon: if a raccoon was pending BEFORE this eat and this eat was exactly -1, queue or set discard
      if (prePendingRaccoon && (predVal - preyVal === 1)) {
        if (actionMode) queuedRaccoonDiscard = true;
        else { actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; }
      }

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
    // clear pre-turn flags (consume flags that applied BEFORE this eat)
    if (prePendingNext) pendingNext = null;
    if (prePendingRaccoon) pendingRaccoonTurns = 0;
    if (prePolarBearSkip) polarBearSkip = false;
    runAbilityAt(newIdx);
    if (prePendingRaccoon && (predVal - preyVal === 1)) {
      if (actionMode) queuedRaccoonDiscard = true;
      else { actionMode = { type: 'raccoonDiscard' }; message = 'Raccoon triggered: choose an UNSTACKED animal to discard.'; }
    }
    checkEnd();
    return;
  }

  // Normal play: select predator then prey
  if (selected === -1) {
    if (grid[i].length === 0) { message = 'Select a non-empty predator to begin.'; return; }
    selected = i; message = 'Predator selected: click a prey to attempt to eat.'; return;
  }

  // attempt eat with the selected predator
  if (i === selected) { selected = -1; message = 'Selection cleared.'; return; }
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

  // clear only those one-time flags that applied BEFORE this eat (consume them)
  if (prePendingNext) pendingNext = null;
  if (prePendingRaccoon) pendingRaccoonTurns = 0;
  if (prePolarBearSkip) polarBearSkip = false;

  // Resolve predator ability first (this may set actionMode for after-eat interactions)
  runAbilityAt(newIdx);

  // raccoon: if a raccoon was pending BEFORE this eat and this eat was exactly -1, queue or set discard
  if (prePendingRaccoon && diff === 1) {
    if (actionMode) {
      queuedRaccoonDiscard = true;
    } else {
      actionMode = { type: 'raccoonDiscard' };
      message = 'Raccoon triggered: choose an UNSTACKED animal to discard.';
    }
  }

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

function checkEnd() {
  // End-of-turn cleanup for turn-based flags
  if (pendingRaccoonTurns > 0) pendingRaccoonTurns--;

  // if any normal moves exist, game continues. If no normal moves and no sea animals left, game ends.
  if (hasNormalMove()) return;
  if (!seaUsed.whale || !seaUsed.shark) {
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
