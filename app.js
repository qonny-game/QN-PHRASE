// ============================================================
// app.js — QNPHRASE
// UI制御・Web Audio再生・TAB描画
// theory.js のグローバル関数/定数に依存
// ============================================================

(function () {
  "use strict";

  // ---------- State ----------
  const state = {
    key: 0, // C
    scaleKey: "major",
    fretMin: 0,
    fretMax: 4, // "1-5F" 相当(0-4フレット)
    bpm: 120,
    metronomeOn: true,
    chordToneOn: true,
    melodyVolume: 0.8,  // 0.0-1.0、生成フレーズ(メロディ)の音量
    chordVolume: 0.6,   // 0.0-1.0、コードトーンの音量
    chordDisplayMode: "degree", // "degree" | "absolute" — コードセルの表示切替
    tabDisplayMode: "fret", // "fret" | "degree" — TAB上の数字表示切替
    numBars: 1, // 1 / 2 / 4 小節から選択(デフォルト1小節)
    progression: (() => {
      const arr = new Array(1 * 4).fill(null);
      arr[0] = { degree: 0, type: "" }; // デフォルト: Beat1にキーのI(トニック)を1個だけセットした状態でスタート
      return arr;
    })(), // {degree: 0-6, type} or null (numBars*4拍ぶん)。degreeはキーからの相対度数、実ルートは都度計算する
    phrase: null, // generatePhrase() の結果
    editingBeatIndex: null,
    isPlaying: false,
    playTimer: null,
    currentPlayBeat: 0,
    currentStockId: null,   // 読み込み中のストックのid(SAVE時に上書き対象として使う)
    currentStockName: null, // 同上、SAVEポップアップの初期名として使う
  };

  const BAR_COUNT_OPTIONS = [1, 2, 4];

  const POSITION_PRESETS = [
    { label: "1-5F", min: 0, max: 4 },
    { label: "3-7F", min: 2, max: 6 },
    { label: "5-9F", min: 4, max: 8 },
    { label: "7-11F", min: 6, max: 10 },
    { label: "9-13F", min: 8, max: 12 },
    { label: "12-16F", min: 11, max: 15 },
    { label: "Open-12F", min: 0, max: 12 },
    { label: "Full Neck", min: 0, max: 20 },
  ];

  const TEMPO_NAMES = [
    { max: 40, name: "Grave" },
    { max: 60, name: "Largo" },
    { max: 66, name: "Larghetto" },
    { max: 76, name: "Adagio" },
    { max: 108, name: "Andante" },
    { max: 120, name: "Moderato" },
    { max: 156, name: "Allegro" },
    { max: 176, name: "Vivace" },
    { max: 999, name: "Presto" },
  ];

  function tempoNameFor(bpm) {
    for (const t of TEMPO_NAMES) if (bpm <= t.max) return t.name;
    return "Presto";
  }

  // ---------- Element refs ----------
  const el = {};
  [
    "keyChip", "keyChipValue", "scaleChip", "scaleChipValue", "positionChip", "positionChipValue",
    "barsChip", "barsChipValue", "barsBackdrop", "barsPopup", "barsGrid", "barsCloseBtn",
    "barBlocks",
    "tabDisplayToggle",
    "generateBtn", "saveBtn", "progClearBtn",
    "transportGenerateBtn", "transportSaveBtn", "transportLoadBtn",
    "confirmBackdrop", "confirmPopup", "confirmTitle", "confirmMessage", "confirmCancelBtn", "confirmOkBtn",
    "saveNameBackdrop", "saveNamePopup", "saveNameInput", "saveNameConfirmBtn", "saveModeRow",
    "stockBtn", "stockBackdrop", "stockPopup", "stockFilterRow", "stockList", "stockCloseBtn",
    "keyBackdrop", "keyPopup", "keyGrid", "keyCloseBtn",
    "scaleBackdrop", "scalePopup", "scaleGrid", "scaleCloseBtn",
    "positionBackdrop", "positionPopup", "positionGrid", "positionCloseBtn",
    "chordBackdrop", "chordPopup", "chordPickTitle", "chordDegreeGrid", "chordTypeGrid", "chordOnBassGrid", "chordClearBtn", "chordCloseBtn",
    "noteInputBackdrop", "noteInputPopup", "noteInputTitle", "fretGrid",
    "noteLengthToggleRow", "noteLengthTotal", "noteClearBtn", "noteInputConfirmBtn",
    "chordDisplayToggle",
    "settingsBtn", "settingsBackdrop", "settingsPopup", "rhythmFeelGrid", "metronomeToggleGrid", "chordToneToggleGrid", "settingsCloseBtn",
    "hamburgerBtn", "hamburgerBackdrop", "hamburgerPopup", "hamburgerCloseBtn",
    "melodyVolumeSlider", "melodyVolumeValue", "chordVolumeSlider", "chordVolumeValue",
    "bpmVal", "tempoName", "bpmMinus2", "bpmPlus2", "bpmDisplayWrap", "playToggle", "playIcon", "metroToggle",
  ].forEach(id => { el[id] = document.getElementById(id); });

  // ---------- Popup helpers ----------
  function openPopup(popupEl, backdropEl) {
    backdropEl.classList.add("open");
    popupEl.classList.add("open");
  }
  function closePopup(popupEl, backdropEl) {
    backdropEl.classList.remove("open");
    popupEl.classList.remove("open");
  }
  function wirePopup(chipOrBtn, popupEl, backdropEl, closeBtnEl) {
    chipOrBtn.addEventListener("click", () => openPopup(popupEl, backdropEl));
    backdropEl.addEventListener("click", () => closePopup(popupEl, backdropEl));
    if (closeBtnEl) closeBtnEl.addEventListener("click", () => closePopup(popupEl, backdropEl));
  }

  // ============================================================
  // KEY picker
  // ============================================================
  function buildKeyGrid() {
    el.keyGrid.innerHTML = "";
    NOTE_NAMES.forEach((name, idx) => {
      const cell = document.createElement("div");
      cell.className = "choice-cell";
      cell.textContent = name;
      if (idx === state.key) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        const oldKey = state.key;
        state.key = idx;
        refreshKeyChip();
        buildKeyGrid();
        // キーが変わると、degree形式で保持しているコード進行の実ルート音が
        // すべて自動的に転調される。グリッド表示(絶対音名モードの場合)と
        // 再生エンジンのコード変化マップを両方更新する。
        refreshProgGrid();

        // 既存のTABフレーズも、キー差分の半音数ぶん実際に移調する
        // (破棄はしない。弾ける場所が無い音は playable:false になり "!" 表記になる)
        if (state.phrase) {
          // 半音差は最も近い方向(-6〜+5)に正規化する。例えばCからBへの変更は
          // +11ではなく-1として扱う(実際の移調として自然な向きにするため)。
          const rawDiff = idx - oldKey;
          const semitones = ((rawDiff + 6) % 12 + 12) % 12 - 6;
          state.phrase = transposePhrase(state.phrase, semitones);
        }
        renderTab();
      });
      el.keyGrid.appendChild(cell);
    });
  }
  function refreshKeyChip() {
    el.keyChipValue.textContent = NOTE_NAMES[state.key];
  }

  // ============================================================
  // SCALE picker
  // ============================================================
  function buildScaleGrid() {
    el.scaleGrid.innerHTML = "";
    SCALE_ORDER.forEach(key => {
      const cell = document.createElement("div");
      cell.className = "choice-cell scale-choice-cell";
      cell.textContent = key === "random" ? "Random" : SCALES[key].label;
      if (key === state.scaleKey) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        state.scaleKey = key;
        refreshScaleChip();
        buildScaleGrid();
      });
      el.scaleGrid.appendChild(cell);
    });
  }
  function refreshScaleChip() {
    el.scaleChipValue.textContent = state.scaleKey === "random" ? "Random" : SCALES[state.scaleKey].label;
  }

  // ============================================================
  // POSITION picker
  // ============================================================
  function buildPositionGrid() {
    el.positionGrid.innerHTML = "";
    POSITION_PRESETS.forEach(p => {
      const cell = document.createElement("div");
      cell.className = "choice-cell";
      cell.textContent = p.label;
      if (p.min === state.fretMin && p.max === state.fretMax) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        state.fretMin = p.min;
        state.fretMax = p.max;
        refreshPositionChip();
        buildPositionGrid();
      });
      el.positionGrid.appendChild(cell);
    });
  }
  function refreshPositionChip() {
    const match = POSITION_PRESETS.find(p => p.min === state.fretMin && p.max === state.fretMax);
    el.positionChipValue.textContent = match ? match.label : (state.fretMin + "-" + state.fretMax + "F");
  }

  // ============================================================
  // Bar blocks: 小節ごとに「コード入力(4拍)」+「その小節のTAB」をまとめて構築する
  // ============================================================
  function buildBarBlocks() {
    el.barBlocks.innerHTML = "";
    for (let bar = 0; bar < state.numBars; bar++) {
      const block = document.createElement("div");
      block.className = "bar-block";
      block.dataset.bar = String(bar);

      const header = document.createElement("div");
      header.className = "bar-block-header";
      const numEl = document.createElement("span");
      numEl.className = "bar-block-num";
      numEl.textContent = "Bar " + (bar + 1);
      const chordLabelEl = document.createElement("span");
      chordLabelEl.className = "bar-block-chord-label";
      chordLabelEl.dataset.role = "chordLabel";
      header.appendChild(numEl);
      header.appendChild(chordLabelEl);
      block.appendChild(header);

      const row = document.createElement("div");
      row.className = "prog-bar-row";
      for (let beat = 0; beat < 4; beat++) {
        const idx = bar * 4 + beat;
        const cell = document.createElement("div");
        cell.className = "prog-cell";
        cell.dataset.index = String(idx);
        renderProgCell(cell, idx);
        cell.addEventListener("click", () => openChordPicker(idx));
        row.appendChild(cell);
      }
      block.appendChild(row);

      const tabArea = document.createElement("div");
      tabArea.className = "bar-block-tab";
      tabArea.dataset.role = "tabArea";
      block.appendChild(tabArea);

      el.barBlocks.appendChild(block);
    }
    refreshAllBarChordLabels();
    renderTab();
  }

  function renderProgCell(cellEl, idx) {
    const chord = state.progression[idx];
    if (chord) {
      cellEl.classList.add("filled");
      cellEl.textContent = chordCellLabel(chord);
    } else {
      cellEl.classList.remove("filled");
      cellEl.textContent = "";
    }
  }

  // コードセル1個の表示文字列を、現在の表示モード(degree/absolute)に応じて作る
  function chordCellLabel(chord) {
    if (state.chordDisplayMode === "absolute") {
      const rootPc = degreeToRootPc(chord.degree, state.key);
      const typeLabel = CHORD_TYPES[chord.type] ? CHORD_TYPES[chord.type].label : "";
      let label = NOTE_NAMES[rootPc] + typeLabel;
      if (chord.onBass !== undefined && chord.onBass !== null) {
        const bassPc = degreeToRootPc(chord.onBass, state.key);
        label += "/" + NOTE_NAMES[bassPc];
      }
      return label;
    }
    return degreeToRoman(chord.degree, chord.type, chord.onBass);
  }

  // 各バーブロックのヘッダーにある「使用コード」表示を更新する(GENERATE前は空表示)
  function refreshAllBarChordLabels() {
    el.barBlocks.querySelectorAll(".bar-block").forEach(block => {
      const bar = parseInt(block.dataset.bar, 10);
      const labelEl = block.querySelector('[data-role="chordLabel"]');
      if (labelEl) labelEl.textContent = chordLabelForBar(bar);
    });
  }

  function refreshProgGrid() {
    el.barBlocks.querySelectorAll(".prog-cell").forEach(cellEl => {
      const idx = parseInt(cellEl.dataset.index, 10);
      renderProgCell(cellEl, idx);
    });
    refreshAllBarChordLabels();
    syncChordChangeMap();
  }

  // コード進行が変わるたびに、再生エンジン側のコード変化マップを再構築する。
  // 再生エンジンは別IIFEで後から初期化されるため、存在チェックしてから呼ぶ。
  function syncChordChangeMap() {
    if (window.__qnphraseAudio && window.__qnphraseAudio.rebuildChordChangeMap) {
      window.__qnphraseAudio.rebuildChordChangeMap();
    }
  }

  // ============================================================
  // Generic confirmation dialog (GENERATE / CLEAR で使う)
  // ============================================================
  let pendingConfirmAction = null;

  function askConfirm(title, message, onConfirm) {
    el.confirmTitle.textContent = title;
    el.confirmMessage.textContent = message;
    pendingConfirmAction = onConfirm;
    openPopup(el.confirmPopup, el.confirmBackdrop);
  }

  el.confirmOkBtn.addEventListener("click", () => {
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    closePopup(el.confirmPopup, el.confirmBackdrop);
    if (action) action();
  });
  el.confirmCancelBtn.addEventListener("click", () => {
    pendingConfirmAction = null;
    closePopup(el.confirmPopup, el.confirmBackdrop);
  });
  el.confirmBackdrop.addEventListener("click", () => {
    pendingConfirmAction = null;
    closePopup(el.confirmPopup, el.confirmBackdrop);
  });

  el.progClearBtn.addEventListener("click", () => {
    askConfirm("Clear Everything", "This will clear all chords and the current phrase. This can't be undone.", () => {
      state.progression = new Array(state.numBars * 4).fill(null);
      state.phrase = null;
      refreshProgGrid();
      renderTab();
    });
  });

  // ---------- Chord display mode toggle (Degree ⇔ Note、1ボタンでタップごとに切替) ----------
  el.chordDisplayToggle.addEventListener("click", () => {
    state.chordDisplayMode = state.chordDisplayMode === "degree" ? "absolute" : "degree";
    el.chordDisplayToggle.textContent = state.chordDisplayMode === "degree" ? "Degree" : "Note";
    refreshProgGrid();
    renderTab();
  });

  // ---------- Bar count (1/2/4) selector — chip + popup (KEY/SCALE/POSと同じ形式) ----------
  function buildBarsGrid() {
    el.barsGrid.innerHTML = "";
    BAR_COUNT_OPTIONS.forEach(n => {
      const cell = document.createElement("div");
      cell.className = "choice-cell";
      cell.textContent = n + (n === 1 ? " Bar" : " Bars");
      if (n === state.numBars) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        setNumBars(n);
        buildBarsGrid();
      });
      el.barsGrid.appendChild(cell);
    });
  }

  function refreshBarsChip() {
    el.barsChipValue.textContent = String(state.numBars);
  }

  function setNumBars(n) {
    if (n === state.numBars) return;
    const oldProgression = state.progression;
    state.numBars = n;
    const newLen = n * 4;
    const newProgression = new Array(newLen).fill(null);
    // 既存の入力はできる範囲で引き継ぐ(縮小時は切り詰め、拡大時はそのまま)
    for (let i = 0; i < Math.min(oldProgression.length, newLen); i++) {
      newProgression[i] = oldProgression[i];
    }
    state.progression = newProgression;
    state.phrase = null;
    syncChordChangeMap();
    refreshBarsChip();
    buildBarBlocks();
  }

  // ============================================================
  // Chord cell picker popup (degree + type for one beat)
  // ============================================================
  let pendingChordDegree = 0;
  let pendingChordType = "";
  let pendingChordOnBass = null; // null=OFF、それ以外はディグリー番号(0-6)

  function openChordPicker(idx) {
    state.editingBeatIndex = idx;
    const existing = state.progression[idx];
    pendingChordDegree = existing ? existing.degree : 0;
    pendingChordType = existing ? existing.type : DEGREES[pendingChordDegree].defaultType;
    pendingChordOnBass = existing && existing.onBass !== undefined ? existing.onBass : null;

    const bar = Math.floor(idx / 4) + 1;
    const beat = (idx % 4) + 1;
    el.chordPickTitle.textContent = "Bar " + bar + " · Beat " + beat;

    buildChordDegreeGrid();
    buildChordTypeGrid();
    buildChordOnBassGrid();
    openPopup(el.chordPopup, el.chordBackdrop);
  }

  function buildChordDegreeGrid() {
    el.chordDegreeGrid.innerHTML = "";
    DEGREES.forEach((def, idx) => {
      const cell = document.createElement("div");
      cell.className = "choice-cell";
      cell.textContent = def.roman;
      if (idx === pendingChordDegree) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        pendingChordDegree = idx;
        // ディグリーを変えたら、そのディグリー本来のタイプに自動で合わせる
        // (人間が普段使う自然なダイアトニックコードにすぐ辿り着けるように)
        pendingChordType = DEGREES[idx].defaultType;
        commitChordCell();
        buildChordDegreeGrid();
        buildChordTypeGrid();
      });
      el.chordDegreeGrid.appendChild(cell);
    });
  }

  function buildChordTypeGrid() {
    el.chordTypeGrid.innerHTML = "";
    CHORD_TYPE_ORDER.forEach(type => {
      const cell = document.createElement("div");
      cell.className = "choice-cell";
      cell.textContent = type === "" ? "Maj" : CHORD_TYPES[type].label;
      if (type === pendingChordType) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        pendingChordType = type;
        commitChordCell();
        buildChordTypeGrid();
      });
      el.chordTypeGrid.appendChild(cell);
    });
  }

  // On Bass(分数コード): ベース音を別のディグリーに指定する機能。OFFボタン+7ディグリー
  function buildChordOnBassGrid() {
    el.chordOnBassGrid.innerHTML = "";
    const offCell = document.createElement("div");
    offCell.className = "choice-cell";
    offCell.textContent = "OFF";
    if (pendingChordOnBass === null) offCell.classList.add("selected");
    offCell.addEventListener("click", () => {
      pendingChordOnBass = null;
      commitChordCell();
      buildChordOnBassGrid();
    });
    el.chordOnBassGrid.appendChild(offCell);

    DEGREES.forEach((def, idx) => {
      const cell = document.createElement("div");
      cell.className = "choice-cell";
      cell.textContent = def.roman;
      if (idx === pendingChordOnBass) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        pendingChordOnBass = idx;
        commitChordCell();
        buildChordOnBassGrid();
      });
      el.chordOnBassGrid.appendChild(cell);
    });
  }

  function commitChordCell() {
    if (state.editingBeatIndex === null) return;
    state.progression[state.editingBeatIndex] = {
      degree: pendingChordDegree,
      type: pendingChordType,
      onBass: pendingChordOnBass,
    };
    refreshProgGrid();
  }

  el.chordClearBtn.addEventListener("click", () => {
    if (state.editingBeatIndex === null) return;
    state.progression[state.editingBeatIndex] = null;
    refreshProgGrid();
    closePopup(el.chordPopup, el.chordBackdrop);
  });

  // ============================================================
  // Manual note input popup (TABの各マスをタップして弦・フレット・長さを手入力)
  // ============================================================
  let editingNote = null; // { beatIdx, slot, string } — 現在編集中のマス位置
  let pendingFret = 0;
  let pendingLengthSteps = 1; // 選択中の長さトグルの合計値(16分=1単位)

  const NOTE_LENGTH_UNITS = [16, 8, 4, 2, 1]; // Whole, Half, Quarter, 8th, 16th の各ステップ数

  function openNoteInputPicker(beatIdx, slot, stringIdx) {
    editingNote = { beatIdx, slot, string: stringIdx };

    // 既存ノートがあれば、その値を初期表示にする
    ensurePhraseExists();
    const beat = state.phrase[beatIdx];
    const existing = beat ? beat.notes.find(n => n.slot === slot && n.string === stringIdx) : null;
    pendingFret = existing ? existing.fret : 0;
    pendingLengthSteps = existing && existing.durationSteps ? existing.durationSteps : 1;

    const bar = Math.floor(beatIdx / 4) + 1;
    const beatInBar = (beatIdx % 4) + 1;
    el.noteInputTitle.textContent = "String " + STRING_LABELS[stringIdx] + " · Bar " + bar + " Beat " + beatInBar;

    buildFretGrid();
    buildNoteLengthToggle();
    openPopup(el.noteInputPopup, el.noteInputBackdrop);
  }

  // 0〜21フレットをボタングリッドで選択する
  function buildFretGrid() {
    el.fretGrid.innerHTML = "";
    for (let f = 0; f <= 21; f++) {
      const cell = document.createElement("div");
      cell.className = "fret-cell";
      cell.textContent = String(f);
      if (f === pendingFret) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        pendingFret = f;
        buildFretGrid();
      });
      el.fretGrid.appendChild(cell);
    }
  }

  // 長さトグル: 選択したボタンの合計ステップ数が実際の音の長さになる
  // (例: Quarter(4) + 16th(1) を選ぶと合計5ステップ=付点8分相当の長さになる)
  let selectedLengthUnits = new Set([1]);

  function buildNoteLengthToggle() {
    // 既存の長さ(合計ステップ数)を、大きい単位から貪欲に分解してトグルの初期選択状態を作る
    // (例: 5steps → Quarter(4) + 16th(1) の組み合わせとして復元する)
    // NOTE_LENGTH_UNITSは既に大きい順([16,8,4,2,1])なのでそのまま順に処理する
    selectedLengthUnits = new Set();
    let remaining = pendingLengthSteps;
    NOTE_LENGTH_UNITS.forEach(unit => {
      if (remaining >= unit) {
        selectedLengthUnits.add(unit);
        remaining -= unit;
      }
    });
    if (selectedLengthUnits.size === 0) selectedLengthUnits.add(1);

    el.noteLengthToggleRow.querySelectorAll(".note-length-btn").forEach(btn => {
      const unit = parseInt(btn.dataset.length, 10);
      btn.classList.toggle("selected", selectedLengthUnits.has(unit));
      btn.onclick = () => {
        if (selectedLengthUnits.has(unit)) {
          if (selectedLengthUnits.size > 1) selectedLengthUnits.delete(unit);
        } else {
          selectedLengthUnits.add(unit);
        }
        btn.classList.toggle("selected", selectedLengthUnits.has(unit));
        refreshLengthTotal();
      };
    });
    refreshLengthTotal();
  }

  function refreshLengthTotal() {
    pendingLengthSteps = Array.from(selectedLengthUnits).reduce((a, b) => a + b, 0);
    el.noteLengthTotal.textContent = String(pendingLengthSteps);
  }

  el.noteInputConfirmBtn.addEventListener("click", () => {
    if (!editingNote) return;
    const { beatIdx, slot, string } = editingNote;
    ensurePhraseExists();
    const beat = state.phrase[beatIdx];
    // 同じ拍・同じ弦・同じスロットの既存ノートを除去してから追加(上書き)
    beat.notes = beat.notes.filter(n => !(n.slot === slot && n.string === string));
    beat.notes.push({ string, fret: pendingFret, slot, durationSteps: pendingLengthSteps, isChordTone: undefined });
    closePopup(el.noteInputPopup, el.noteInputBackdrop);
    renderTab();
  });

  el.noteClearBtn.addEventListener("click", () => {
    if (!editingNote) return;
    const { beatIdx, slot, string } = editingNote;
    ensurePhraseExists();
    const beat = state.phrase[beatIdx];
    beat.notes = beat.notes.filter(n => !(n.slot === slot && n.string === string));
    closePopup(el.noteInputPopup, el.noteInputBackdrop);
    renderTab();
  });

  el.noteInputBackdrop.addEventListener("click", () => closePopup(el.noteInputPopup, el.noteInputBackdrop));

  // ---------- Wire popups ----------
  wirePopup(el.keyChip, el.keyPopup, el.keyBackdrop, el.keyCloseBtn);
  wirePopup(el.scaleChip, el.scalePopup, el.scaleBackdrop, el.scaleCloseBtn);
  wirePopup(el.positionChip, el.positionPopup, el.positionBackdrop, el.positionCloseBtn);
  wirePopup(el.barsChip, el.barsPopup, el.barsBackdrop, el.barsCloseBtn);
  el.chordCloseBtn.addEventListener("click", () => closePopup(el.chordPopup, el.chordBackdrop));
  el.chordBackdrop.addEventListener("click", () => closePopup(el.chordPopup, el.chordBackdrop));

  wirePopup(el.settingsBtn, el.settingsPopup, el.settingsBackdrop, el.settingsCloseBtn);
  wirePopup(el.hamburgerBtn, el.hamburgerPopup, el.hamburgerBackdrop, el.hamburgerCloseBtn);

  // Init
  buildKeyGrid();
  buildScaleGrid();
  buildPositionGrid();
  buildBarsGrid();
  refreshKeyChip();
  refreshScaleChip();
  refreshPositionChip();
  refreshBarsChip();

  // ============================================================
  // Settings popup: rhythm feel / metronome toggle
  // ============================================================
  const RHYTHM_FEELS = [
    { key: "straight", label: "Straight" },
    { key: "sparse", label: "Sparse" },
    { key: "dense", label: "Dense" },
  ];
  state.rhythmFeel = "straight";

  function buildRhythmFeelGrid() {
    el.rhythmFeelGrid.innerHTML = "";
    RHYTHM_FEELS.forEach(f => {
      const cell = document.createElement("div");
      cell.className = "choice-cell";
      cell.textContent = f.label;
      if (f.key === state.rhythmFeel) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        state.rhythmFeel = f.key;
        buildRhythmFeelGrid();
      });
      el.rhythmFeelGrid.appendChild(cell);
    });
  }

  function buildMetronomeToggleGrid() {
    el.metronomeToggleGrid.innerHTML = "";
    ["On", "Off"].forEach(label => {
      const cell = document.createElement("div");
      cell.className = "choice-cell";
      cell.textContent = label;
      const isOn = label === "On";
      if (isOn === state.metronomeOn) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        state.metronomeOn = isOn;
        refreshMetroBtn();
        buildMetronomeToggleGrid();
      });
      el.metronomeToggleGrid.appendChild(cell);
    });
  }

  function buildChordToneToggleGrid() {
    el.chordToneToggleGrid.innerHTML = "";
    ["On", "Off"].forEach(label => {
      const cell = document.createElement("div");
      cell.className = "choice-cell";
      cell.textContent = label;
      const isOn = label === "On";
      if (isOn === state.chordToneOn) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        state.chordToneOn = isOn;
        buildChordToneToggleGrid();
      });
      el.chordToneToggleGrid.appendChild(cell);
    });
  }

  buildRhythmFeelGrid();
  buildMetronomeToggleGrid();
  buildChordToneToggleGrid();

  // ---------- Volume sliders ----------
  function refreshVolumeDisplays() {
    el.melodyVolumeValue.textContent = Math.round(state.melodyVolume * 100) + "%";
    el.chordVolumeValue.textContent = Math.round(state.chordVolume * 100) + "%";
  }
  el.melodyVolumeSlider.value = String(Math.round(state.melodyVolume * 100));
  el.chordVolumeSlider.value = String(Math.round(state.chordVolume * 100));
  refreshVolumeDisplays();
  el.melodyVolumeSlider.addEventListener("input", () => {
    state.melodyVolume = parseInt(el.melodyVolumeSlider.value, 10) / 100;
    refreshVolumeDisplays();
  });
  el.chordVolumeSlider.addEventListener("input", () => {
    state.chordVolume = parseInt(el.chordVolumeSlider.value, 10) / 100;
    refreshVolumeDisplays();
  });

  // ============================================================
  // Tempo controls
  // ============================================================
  function refreshTempoDisplay() {
    el.bpmVal.textContent = String(state.bpm);
    el.tempoName.textContent = tempoNameFor(state.bpm);
  }

  function setBpm(v) {
    state.bpm = Math.max(30, Math.min(300, v));
    refreshTempoDisplay();
    if (state.isPlaying && window.__qnphraseAudio) window.__qnphraseAudio.restart();
  }

  el.bpmMinus2.addEventListener("click", () => setBpm(state.bpm - 1));
  el.bpmPlus2.addEventListener("click", () => setBpm(state.bpm + 1));

  // ---------- BPM数字を左右スワイプでシームレスに変更する ----------
  (function wireBpmSwipe() {
    let dragging = false;
    let startX = 0;
    let startBpm = 0;
    const PX_PER_BPM = 6; // この幅だけ動かすとBPMが1変わる

    el.bpmDisplayWrap.addEventListener("pointerdown", (ev) => {
      dragging = true;
      startX = ev.clientX;
      startBpm = state.bpm;
      el.bpmDisplayWrap.setPointerCapture(ev.pointerId);
    });
    el.bpmDisplayWrap.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const deltaX = ev.clientX - startX;
      const deltaBpm = Math.round(deltaX / PX_PER_BPM);
      setBpm(startBpm + deltaBpm);
    });
    function endDrag(ev) {
      if (!dragging) return;
      dragging = false;
      try { el.bpmDisplayWrap.releasePointerCapture(ev.pointerId); } catch (e) {}
    }
    el.bpmDisplayWrap.addEventListener("pointerup", endDrag);
    el.bpmDisplayWrap.addEventListener("pointercancel", endDrag);
  })();

  function refreshMetroBtn() {
    if (state.metronomeOn) el.metroToggle.classList.add("active");
    else el.metroToggle.classList.remove("active");
  }
  el.metroToggle.addEventListener("click", () => {
    state.metronomeOn = !state.metronomeOn;
    refreshMetroBtn();
    buildMetronomeToggleGrid();
  });

  refreshTempoDisplay();
  refreshMetroBtn();

  // ============================================================
  // TAB rendering (SVG) — 1小節を横幅100%として縦に積んで表示
  // ============================================================
  // レイアウト定数(1小節ぶんのSVG内部座標)
  const TAB_STRING_GAP = 16;      // 弦間隔(px)
  const TAB_TOP_MARGIN = 14;      // 上下の余白
  const TAB_LEFT_MARGIN = 12;
  const TAB_RIGHT_MARGIN = 12;
  const TAB_BEAT_WIDTH = 90;      // 1拍あたりの内部座標幅(viewBox基準、横幅100%に自動フィットする)
  const TAB_SLOT_WIDTH = TAB_BEAT_WIDTH / 4;

  // TAB上の1ノートに表示する文字列を、現在の表示モード(fret/degree)に応じて作る。
  // degreeモードでは、そのタイミングのコードのルートを基準にスケール度数を計算する。
  function tabNoteLabel(note, beatIdx) {
    if (note.playable === false) return "!";
    if (state.tabDisplayMode !== "degree") return String(note.fret);
    const ctx = state.lastGenerateContext;
    if (!ctx || !ctx.resolvedProgression) return String(note.fret);
    const chord = ctx.resolvedProgression[beatIdx];
    if (!chord) return String(note.fret);
    const midi = TUNING_MIDI[note.string] + note.fret;
    const pc = ((midi % 12) + 12) % 12;
    return pitchClassToScaleDegreeLabel(pc, chord.root, ctx.scaleKey);
  }

  // 指定小節(bar番号, 0始まり)で使われているコードのラベルを作る。
  // 小節内でコードが変化する場合は" → "区切りで列挙し、連続する同一コードはまとめる。
  // 表示形式はCHORD PROGRESSION側のchordDisplayMode(degree/absolute)に連動する。
  function chordLabelForBar(bar) {
    const ctx = state.lastGenerateContext;
    if (!ctx || !ctx.resolvedProgression) return "";
    const labels = [];
    for (let beatInBar = 0; beatInBar < 4; beatInBar++) {
      const beatIdx = bar * 4 + beatInBar;
      const chord = ctx.resolvedProgression[beatIdx];
      if (!chord) continue;
      let label;
      const hasBass = chord.bassRoot !== undefined && chord.bassRoot !== null;
      if (state.chordDisplayMode === "absolute") {
        const typeLabel = CHORD_TYPES[chord.type] ? CHORD_TYPES[chord.type].label : "";
        label = NOTE_NAMES[chord.root] + typeLabel;
        if (hasBass) label += "/" + NOTE_NAMES[chord.bassRoot];
      } else {
        const degree = rootPcToDegree(chord.root, state.key);
        const bassDegree = hasBass ? rootPcToDegree(chord.bassRoot, state.key) : null;
        label = degree !== null ? degreeToRoman(degree, chord.type, bassDegree) : NOTE_NAMES[chord.root] + (chord.type || "");
      }
      if (labels.length === 0 || labels[labels.length - 1] !== label) {
        labels.push(label);
      }
    }
    return labels.join(" → ");
  }

  function renderTab() {
    const svgns = "http://www.w3.org/2000/svg";
    const barWidth = TAB_LEFT_MARGIN + TAB_RIGHT_MARGIN + 4 * TAB_BEAT_WIDTH;
    const barHeight = TAB_TOP_MARGIN * 2 + TAB_STRING_GAP * 5;

    function yFor(stringIdx) {
      // stringIdx: 0=6弦(低音,下) ... 5=1弦(高音,上) → 画面上は1弦を上に表示
      const visualRow = 5 - stringIdx;
      return TAB_TOP_MARGIN + visualRow * TAB_STRING_GAP;
    }
    function xFor(beatInBar, slot) {
      return TAB_LEFT_MARGIN + beatInBar * TAB_BEAT_WIDTH + slot * TAB_SLOT_WIDTH + TAB_SLOT_WIDTH / 2;
    }

    // フレーズが無い場合でも手弾き入力できるよう、常に空の拍配列を用意しておく
    ensurePhraseExists();
    const phrase = state.phrase;

    el.barBlocks.querySelectorAll(".bar-block").forEach(block => {
      const bar = parseInt(block.dataset.bar, 10);
      const tabArea = block.querySelector('[data-role="tabArea"]');
      if (!tabArea) return;
      tabArea.innerHTML = "";

      const svg = document.createElementNS(svgns, "svg");
      svg.setAttribute("class", "tab-bar-svg");
      svg.setAttribute("viewBox", "0 0 " + barWidth + " " + barHeight);
      svg.setAttribute("preserveAspectRatio", "none");

      function addEl(tag, attrs) {
        const e = document.createElementNS(svgns, tag);
        Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k]));
        svg.appendChild(e);
        return e;
      }

      // 6本の弦の横線
      for (let s = 0; s < 6; s++) {
        addEl("line", {
          x1: TAB_LEFT_MARGIN - 4, y1: yFor(s),
          x2: barWidth - TAB_RIGHT_MARGIN + 4, y2: yFor(s),
          stroke: "#3a3a45", "stroke-width": 1,
        });
      }

      // 小節の外枠(左右の区切り線)
      addEl("line", {
        x1: TAB_LEFT_MARGIN, y1: yFor(5) - 6, x2: TAB_LEFT_MARGIN, y2: yFor(0) + 6,
        stroke: "#2a2a35", "stroke-width": 1.5,
      });
      addEl("line", {
        x1: barWidth - TAB_RIGHT_MARGIN, y1: yFor(5) - 6, x2: barWidth - TAB_RIGHT_MARGIN, y2: yFor(0) + 6,
        stroke: "#2a2a35", "stroke-width": 1.5,
      });
      // 拍の区切り線(小節内、薄め)
      for (let b = 1; b < 4; b++) {
        const x = TAB_LEFT_MARGIN + b * TAB_BEAT_WIDTH;
        addEl("line", {
          x1: x, y1: yFor(5) - 3, x2: x, y2: yFor(0) + 3,
          stroke: "#242430", "stroke-width": 1,
        });
      }

      // タップ可能な当たり判定(各弦×各16分スロット)を、既存ノートの下に敷く。
      // 手弾き入力: タップした弦・拍・スロットを起点に、フレット+長さ入力ポップアップを開く。
      for (let beatInBar = 0; beatInBar < 4; beatInBar++) {
        const beatIdx = bar * 4 + beatInBar;
        for (let slot = 0; slot < 4; slot++) {
          for (let s = 0; s < 6; s++) {
            const x = xFor(beatInBar, slot);
            const y = yFor(s);
            const hit = addEl("rect", {
              x: x - TAB_SLOT_WIDTH / 2, y: y - TAB_STRING_GAP / 2,
              width: TAB_SLOT_WIDTH, height: TAB_STRING_GAP,
              fill: "transparent", "class": "tab-hit-cell",
              "data-beat": beatIdx, "data-slot": slot, "data-string": s,
            });
            hit.addEventListener("click", () => openNoteInputPicker(beatIdx, slot, s));
          }
        }
      }

      // この小節ぶんのノートを描画
      for (let beatInBar = 0; beatInBar < 4; beatInBar++) {
        const beatIdx = bar * 4 + beatInBar;
        const beat = phrase[beatIdx];
        if (!beat) continue;
        beat.notes.forEach(note => {
          const x = xFor(beatInBar, note.slot);
          const y = yFor(note.string);
          const isUnplayable = note.playable === false;

          // 音の長さ(durationSteps)ぶん、矩形の幅を横に伸ばす。
          // ただし小節の右端(このバーの最終スロット)を超えないよう切り詰める
          // (小節をまたぐサステインの表示はここでは扱わない)。
          const durSteps = Math.max(1, note.durationSteps || 1);
          const globalSlotInBar = beatInBar * 4 + note.slot;
          const maxSlotsInBar = 16 - globalSlotInBar;
          const visibleSteps = Math.min(durSteps, maxSlotsInBar);
          const rectWidth = Math.max(16, visibleSteps * TAB_SLOT_WIDTH - 4);
          const rectX = x - 8;

          const rectEl = addEl("rect", {
            x: rectX, y: y - 7, width: rectWidth, height: 14, rx: 4,
            fill: "#0d0d0f", stroke: isUnplayable ? "#ef4444" : "#3b82f6", "stroke-width": 1,
            "class": "tab-note-rect",
          });
          rectEl.addEventListener("click", (ev) => {
            ev.stopPropagation();
            openNoteInputPicker(beatIdx, note.slot, note.string);
          });
          const t = addEl("text", {
            x: rectX + 8, y: y + 4, "text-anchor": "middle",
            "font-family": "Instrument Sans, sans-serif",
            "font-size": 10, "font-weight": 700,
            fill: isUnplayable ? "#ef4444" : "#f0f0f3",
            "pointer-events": "none",
          });
          t.textContent = tabNoteLabel(note, beatIdx);
        });
      }

      tabArea.appendChild(svg);
    });

    refreshAllBarChordLabels();
  }

  // state.phraseがまだ無い(GENERATE前)場合に、手弾き入力を始められるよう
  // 空の拍配列を用意する。numBars変更等でも長さを合わせ直す。
  function ensurePhraseExists() {
    const numBeats = state.numBars * 4;
    if (!state.phrase || state.phrase.length !== numBeats) {
      const fresh = new Array(numBeats);
      for (let i = 0; i < numBeats; i++) {
        // 既存のノートがあれば引き継ぐ(長さが変わっていない範囲)
        fresh[i] = (state.phrase && state.phrase[i]) ? state.phrase[i] : { notes: [] };
      }
      state.phrase = fresh;
    }
  }

  // ---------- TAB display mode toggle (Fret ⇔ Degree、1ボタンでタップごとに切替) ----------
  el.tabDisplayToggle.addEventListener("click", () => {
    state.tabDisplayMode = state.tabDisplayMode === "fret" ? "degree" : "fret";
    el.tabDisplayToggle.textContent = state.tabDisplayMode === "fret" ? "Fret" : "Degree";
    renderTab();
  });

  // ============================================================
  // Phrase generation
  // ============================================================
  function hasAnyChord() {
    return state.progression.some(c => c !== null);
  }

  // degree形式のprogression({degree, type})を、theory.js側が期待する
  // root形式({root: pc, type})に変換する。キーに応じて実際のルート音を都度計算するため、
  // キーを変更しても常に正しく転調された絶対音名でフレーズが生成される。
  function progressionToRootForm(progression, keyPc) {
    return progression.map(cell => {
      if (!cell) return null;
      const result = { root: degreeToRootPc(cell.degree, keyPc), type: cell.type };
      if (cell.onBass !== undefined && cell.onBass !== null) {
        result.bassRoot = degreeToRootPc(cell.onBass, keyPc);
      }
      return result;
    });
  }

  // 各バーブロックのTAB表示エリアに、一時的なメッセージ(コード未設定等)を表示する
  function showTabMessage(message) {
    el.barBlocks.querySelectorAll('[data-role="tabArea"]').forEach(tabArea => {
      tabArea.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "bar-block-tab-empty";
      empty.textContent = message;
      tabArea.appendChild(empty);
    });
    // メッセージは一時的な通知なので、少し経ったらタップ可能なグリッド表示に戻す
    setTimeout(() => renderTab(), 1800);
  }

  function runGenerate() {
    const options = {
      key: state.key,
      scaleKey: state.scaleKey,
      fretMin: state.fretMin,
      fretMax: state.fretMax,
    };
    const rootFormProgression = progressionToRootForm(state.progression, state.key);
    state.phrase = generatePhrase(rootFormProgression, options);
    // TABの度数表記用に、実際に使われたスケール(ランダムモードの場合は解決後の値)と
    // 各拍のルート情報を保存しておく。generatePhrase内で削除される前にコピーする。
    state.lastGenerateContext = {
      scaleKey: options._resolvedRandomScale || state.scaleKey,
      resolvedProgression: resolveProgression(rootFormProgression),
    };
    // 新しく生成したフレーズは元のストックとは別物なので、上書き対象から外す
    // (SAVEすると常に新規保存になる。上書きしたい場合はSTOCKから読み込み直す)
    state.currentStockId = null;
    state.currentStockName = null;
    renderTab();
    // 生成のたびにランダムスケール解決値をリセット(次回また新規ランダム選択させる)
    delete options._resolvedRandomScale;
  }

  // 既存のフレーズ(手弾き入力ぶんを含む)に何かノートが入っているか判定する
  function hasAnyNotes() {
    return !!(state.phrase && state.phrase.some(beat => beat.notes.length > 0));
  }

  el.generateBtn.addEventListener("click", () => {
    if (!hasAnyChord()) {
      showTabMessage("Set at least one chord first");
      return;
    }
    if (hasAnyNotes()) {
      askConfirm("Generate New Phrase", "This will replace the current TAB (including any manual notes) with a new generated phrase.", runGenerate);
    } else {
      runGenerate();
    }
  });

  // ============================================================
  // Stock (saved phrases) — localStorage永続化
  // ============================================================
  const STOCK_STORAGE_KEY = "qnphrase_stock_v1";
  let stockFilter = "all"; // "all" | "favorite"

  function loadStock() {
    try {
      const raw = localStorage.getItem(STOCK_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveStockList(list) {
    try {
      localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function formatSavedAt(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // ---------- Save flow ----------
  let saveMode = "new"; // "new" | "overwrite"

  el.saveBtn.addEventListener("click", () => {
    if (!state.phrase) {
      // フレーズ未生成の場合は保存できない旨をTAB欄に一瞬表示
      showTabMessage("Generate a phrase first");
      return;
    }
    // 既にストックを読み込んで編集中なら、New/Overwriteを選べるようにする
    if (state.currentStockId) {
      el.saveModeRow.style.display = "flex";
      saveMode = "overwrite";
      el.saveModeRow.querySelectorAll(".save-mode-btn").forEach(b => {
        b.classList.toggle("selected", b.dataset.mode === saveMode);
      });
      el.saveNameInput.value = state.currentStockName || "";
    } else {
      el.saveModeRow.style.display = "none";
      saveMode = "new";
      el.saveNameInput.value = "";
    }
    openPopup(el.saveNamePopup, el.saveNameBackdrop);
    setTimeout(() => el.saveNameInput.focus(), 250);
  });

  el.saveModeRow.querySelectorAll(".save-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      saveMode = btn.dataset.mode;
      el.saveModeRow.querySelectorAll(".save-mode-btn").forEach(b => b.classList.toggle("selected", b === btn));
    });
  });

  el.saveNameConfirmBtn.addEventListener("click", () => {
    if (!state.phrase) {
      closePopup(el.saveNamePopup, el.saveNameBackdrop);
      return;
    }
    const rawName = el.saveNameInput.value.trim();
    const name = rawName || (NOTE_NAMES[state.key] + " " + (state.scaleKey === "random" ? "Random" : SCALES[state.scaleKey].label));

    const entryData = {
      name: name,
      savedAt: new Date().toISOString(),
      // 完全再現に必要な状態一式
      key: state.key,
      scaleKey: state.scaleKey,
      fretMin: state.fretMin,
      fretMax: state.fretMax,
      numBars: state.numBars,
      progression: state.progression,
      phrase: state.phrase,
      lastGenerateContext: state.lastGenerateContext || null,
    };

    const list = loadStock();

    if (saveMode === "overwrite" && state.currentStockId) {
      // 既存エントリを見つけて内容だけ更新する(id・favoriteは維持する)
      const idx = list.findIndex(e => e.id === state.currentStockId);
      if (idx !== -1) {
        list[idx] = Object.assign({}, list[idx], entryData);
      } else {
        // 元のエントリが既に削除されていた場合は新規として保存する
        entryData.id = "phrase_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
        entryData.favorite = false;
        list.unshift(entryData);
        state.currentStockId = entryData.id;
      }
    } else {
      entryData.id = "phrase_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
      entryData.favorite = false;
      list.unshift(entryData); // 新しいものを先頭に
      state.currentStockId = entryData.id;
    }
    state.currentStockName = name;

    saveStockList(list);
    closePopup(el.saveNamePopup, el.saveNameBackdrop);
  });

  el.saveNameBackdrop.addEventListener("click", () => closePopup(el.saveNamePopup, el.saveNameBackdrop));

  // ---------- Stock list rendering ----------
  function renderStockList() {
    const list = loadStock();
    const filtered = stockFilter === "favorite" ? list.filter(e => e.favorite) : list;

    el.stockList.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "stock-empty";
      empty.textContent = stockFilter === "favorite" ? "No favorites yet" : "No saved phrases yet";
      el.stockList.appendChild(empty);
      return;
    }

    filtered.forEach(entry => {
      const row = document.createElement("div");
      row.className = "stock-row";

      const main = document.createElement("div");
      main.className = "stock-row-main";
      const nameEl = document.createElement("div");
      nameEl.className = "stock-row-name";
      nameEl.textContent = entry.name;
      const metaEl = document.createElement("div");
      metaEl.className = "stock-row-meta";
      const scaleLabel = entry.scaleKey === "random" ? "Random" : (SCALES[entry.scaleKey] ? SCALES[entry.scaleKey].label : entry.scaleKey);
      metaEl.textContent = NOTE_NAMES[entry.key] + " · " + scaleLabel + " · " + entry.numBars + (entry.numBars === 1 ? " Bar" : " Bars") + " · " + formatSavedAt(entry.savedAt);
      main.appendChild(nameEl);
      main.appendChild(metaEl);
      main.addEventListener("click", () => loadStockEntry(entry));

      const favBtn = document.createElement("button");
      favBtn.className = "stock-row-fav" + (entry.favorite ? " active" : "");
      favBtn.textContent = entry.favorite ? "★" : "☆";
      favBtn.title = entry.favorite ? "Remove from favorites" : "Add to favorites";
      favBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleFavorite(entry.id);
      });

      const delBtn = document.createElement("button");
      delBtn.className = "stock-row-delete";
      delBtn.textContent = "✕";
      delBtn.title = "Delete";
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        deleteStockEntry(entry.id);
      });

      row.appendChild(main);
      row.appendChild(favBtn);
      row.appendChild(delBtn);
      el.stockList.appendChild(row);
    });
  }

  function toggleFavorite(id) {
    const list = loadStock();
    const entry = list.find(e => e.id === id);
    if (entry) entry.favorite = !entry.favorite;
    saveStockList(list);
    renderStockList();
  }

  function deleteStockEntry(id) {
    const list = loadStock();
    const next = list.filter(e => e.id !== id);
    saveStockList(next);
    renderStockList();
  }

  // ストックの項目をタップ → 現在の状態に完全復元する
  function loadStockEntry(entry) {
    state.key = entry.key;
    state.scaleKey = entry.scaleKey;
    state.fretMin = entry.fretMin;
    state.fretMax = entry.fretMax;
    state.numBars = entry.numBars;
    // 後方互換: 旧バージョン(root形式 {root, type})で保存されたストックは、
    // 現在のキーを基準にdegree形式へ変換してから読み込む
    state.progression = entry.progression.map(cell => {
      if (!cell) return null;
      if (cell.degree !== undefined) return { degree: cell.degree, type: cell.type };
      // 旧形式: rootが一番近いディグリーを逆算する(キーからの半音差で判定)
      const matchedDegree = rootPcToDegree(cell.root, entry.key);
      return { degree: matchedDegree !== null ? matchedDegree : 0, type: cell.type };
    });
    state.phrase = entry.phrase;
    // 旧バージョンのストック(lastGenerateContextが無い)は、現在のscaleKey・
    // 復元後progressionから即席のコンテキストを組み立てる(度数表記が動くように)
    state.lastGenerateContext = entry.lastGenerateContext || {
      scaleKey: entry.scaleKey,
      resolvedProgression: resolveProgression(progressionToRootForm(state.progression, entry.key)),
    };
    // どのストックを読み込んで編集中かを記録しておく(SAVE時の上書き判定に使う)
    state.currentStockId = entry.id;
    state.currentStockName = entry.name;

    refreshKeyChip();
    refreshScaleChip();
    refreshPositionChip();
    refreshBarsChip();
    buildKeyGrid();
    buildScaleGrid();
    buildPositionGrid();
    buildBarsGrid();
    syncChordChangeMap();
    buildBarBlocks();

    closePopup(el.stockPopup, el.stockBackdrop);
  }

  // ---------- Filter tabs ----------
  el.stockFilterRow.querySelectorAll(".stock-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      stockFilter = btn.dataset.filter;
      el.stockFilterRow.querySelectorAll(".stock-filter-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      renderStockList();
    });
  });

  // ---------- Open/close stock popup ----------
  el.stockBtn.addEventListener("click", () => {
    renderStockList();
    openPopup(el.stockPopup, el.stockBackdrop);
  });
  el.stockCloseBtn.addEventListener("click", () => closePopup(el.stockPopup, el.stockBackdrop));
  el.stockBackdrop.addEventListener("click", () => closePopup(el.stockPopup, el.stockBackdrop));

  // ---------- Spacer sync (固定トランスポートの高さぶん、コンテンツ下部に余白を確保) ----------
  const topControlsEl = document.getElementById("topControls");
  const topControlsSpacerEl = document.getElementById("topControlsSpacer");
  function syncSpacer() {
    topControlsSpacerEl.style.height = topControlsEl.offsetHeight + "px";
  }
  window.addEventListener("resize", () => {
    syncSpacer();
    renderTab();
  });
  syncSpacer();
  buildBarBlocks();

  // ---------- Bottom transport shortcuts (Generate/Save/Load) — 既存ボタンのクリックを中継する ----------
  el.transportGenerateBtn.addEventListener("click", () => el.generateBtn.click());
  el.transportSaveBtn.addEventListener("click", () => el.saveBtn.click());
  el.transportLoadBtn.addEventListener("click", () => el.stockBtn.click());

  // Expose state to other script chunks in this file
  window.__qnphrase = { state, el, tempoNameFor, POSITION_PRESETS, renderTab, syncSpacer };
})();

// ============================================================
// Web Audio playback engine
// ギター音(シンプルなプラック風合成)+ メトロノームクリック
// ============================================================
(function () {
  "use strict";
  const q = window.__qnphrase;
  const state = q.state;
  const el = q.el;

  let audioCtx = null;
  let scheduleTimerId = null;
  let nextStepTime = 0;
  let currentStep = 0; // 0-127 (32拍 x 4スロット)
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_SEC = 0.12;

  function ensureCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  // 弦・フレットからギター周波数を計算
  function freqForNote(stringIdx, fret) {
    const midi = TUNING_MIDI[stringIdx] + fret;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // メロディ用ギター音: 次のノートまで音を伸ばすサステイン系の音色。
  // アタックは強め、その後はゆるやかに減衰しつつ、durationいっぱいまで
  // 芯の残る音量を保つ(完全に0まで減衰させない=次の音まで自然に繋がる)。
  function playGuitarNote(freq, time, duration) {
    const ctx = ensureCtx();
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc2.type = "triangle";
    osc2.frequency.value = freq * 2.005; // 微デチューンで厚みを出す

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3400, time);
    filter.frequency.exponentialRampToValueAtTime(1100, time + Math.min(duration, 0.35));
    filter.Q.value = 0.6;

    const vol = Math.max(0.0001, state.melodyVolume);
    const peakLevel = 0.22 * vol;
    const sustainLevel = 0.11 * vol;
    const releaseStart = Math.max(time + 0.02, time + duration - 0.05);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peakLevel, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(sustainLevel, time + 0.14);
    gain.gain.setValueAtTime(sustainLevel, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.04);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + duration + 0.06);
    osc2.stop(time + duration + 0.06);
  }

  // コードのベース/ハーモニー音(和音をしっかり伸ばす)。
  // 「コードが変わった瞬間」に呼ばれ、そのコードが続く拍数ぶん長く伸ばす。
  function playChordTone(freq, time, duration, isRoot) {
    const ctx = ensureCtx();
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc2.type = "triangle";
    osc2.frequency.value = freq * 1.003; // 微デチューンで厚みを出す

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2600, time);
    filter.frequency.exponentialRampToValueAtTime(900, time + Math.min(duration, 0.6));
    filter.Q.value = 0.5;

    const vol = Math.max(0.0001, state.chordVolume);
    // ルート音は少し前に出し、3rd/5thは控えめに(和音のバランスを取る)
    const peakLevel = (isRoot ? 0.20 : 0.13) * vol;
    const sustainLevel = (isRoot ? 0.12 : 0.08) * vol;
    const releaseStart = Math.max(time + 0.05, time + duration - 0.12);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peakLevel, time + 0.03);
    gain.gain.exponentialRampToValueAtTime(sustainLevel, time + 0.25);
    gain.gain.setValueAtTime(sustainLevel, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.08);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + duration + 0.12);
    osc2.stop(time + duration + 0.12);
  }

  function playClick(time, accent) {
    const ctx = ensureCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1500 : 1000;
    gain.gain.setValueAtTime(accent ? 0.12 : 0.07, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  function stepDurationSec() {
    // 1拍=4スロット(16分音符単位)
    const beatSec = 60 / state.bpm;
    return beatSec / 4;
  }

  function totalSteps() {
    return state.progression.length * 4;
  }

  function scheduler() {
    const ctx = ensureCtx();
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      scheduleStep(currentStep, nextStepTime);
      nextStepTime += stepDurationSec();
      currentStep++;
      if (currentStep >= totalSteps()) currentStep = 0;
    }
    scheduleTimerId = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  // コード進行から「変化点」の一覧を作り、beatIdx→変化情報の高速参照用Mapを構築する。
  // フレーズ生成時・小節数変更時など、コード進行が変わるたびに再構築が必要。
  let chordChangeMap = new Map();
  function rebuildChordChangeMap() {
    chordChangeMap = new Map();
    // degree形式のprogressionを、キーに応じた絶対root形式に変換してから解析する
    const rootFormProgression = state.progression.map(cell => {
      if (!cell) return null;
      const result = { root: degreeToRootPc(cell.degree, state.key), type: cell.type };
      if (cell.onBass !== undefined && cell.onBass !== null) {
        result.bassRoot = degreeToRootPc(cell.onBass, state.key);
      }
      return result;
    });
    const changes = resolveChordChanges(rootFormProgression);
    changes.forEach(ch => chordChangeMap.set(ch.beatIdx, ch));
  }
  rebuildChordChangeMap();

  function scheduleStep(step, time) {
    const beatIdx = Math.floor(step / 4);
    const slot = step % 4;
    const stepSec = stepDurationSec();

    // メトロノーム: 各拍の頭(slot===0)でクリック、小節頭はアクセント
    if (state.metronomeOn && slot === 0) {
      const accent = beatIdx % 4 === 0;
      playClick(time, accent);
    }

    // コードトーン再生: コードが変化した拍の頭でのみアタックし、
    // そのコードが続く拍数ぶん長く伸ばす(同じコードが続く間は再アタックしない)。
    if (state.chordToneOn !== false && slot === 0) {
      const change = chordChangeMap.get(beatIdx);
      if (change) {
        const tones = chordPitchClasses(change.root, change.type || "");
        const sustainSec = stepSec * 4 * change.durationBeats * 0.98;
        // onBass(分数コード)が指定されている場合、最低音(ベース)をそのピッチクラスに差し替える
        const bassPc = (change.bassRoot !== undefined && change.bassRoot !== null) ? change.bassRoot : change.root;
        const baseBassMidi = 36 + bassPc;
        playChordTone(440 * Math.pow(2, (baseBassMidi - 69) / 12), time, sustainSec, true);
        tones.forEach((tonePc, i) => {
          if (i === 0) return; // ルート(通常のベース位置)はonBassのベース音で代替済みなのでスキップ
          const baseMidi = 36 + tonePc + 12; // 3rd/5th等は1オクターブ上
          const freq = 440 * Math.pow(2, (baseMidi - 69) / 12);
          playChordTone(freq, time, sustainSec, false);
        });
      }
    }

    // フレーズノート再生(次のノートまでサステイン)
    if (state.phrase && state.phrase[beatIdx]) {
      const beat = state.phrase[beatIdx];
      beat.notes.forEach(note => {
        if (note.slot === slot && note.playable !== false) {
          const freq = freqForNote(note.string, note.fret);
          const durSteps = note.durationSteps || 1;
          playGuitarNote(freq, time, stepSec * durSteps);
        }
      });
    }

    // UI更新はメインスレッドで少し遅延して行う(再生ヘッドのハイライト)
    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => highlightPlayhead(beatIdx), delayMs);
  }

  function highlightPlayhead(beatIdx) {
    if (!state.isPlaying) return;
    document.querySelectorAll(".prog-cell.playing").forEach(c => c.classList.remove("playing"));
    const cell = el.barBlocks.querySelector('.prog-cell[data-index="' + beatIdx + '"]');
    if (cell) cell.classList.add("playing");
  }

  function startPlayback() {
    const ctx = ensureCtx();
    state.isPlaying = true;
    currentStep = 0;
    nextStepTime = ctx.currentTime + 0.05;
    scheduler();
    el.playToggle.classList.add("playing");
    el.playIcon.innerHTML = '<path d="M6 6h12v12H6z"></path>';
  }

  function stopPlayback() {
    state.isPlaying = false;
    if (scheduleTimerId) clearTimeout(scheduleTimerId);
    scheduleTimerId = null;
    el.playToggle.classList.remove("playing");
    el.playIcon.innerHTML = '<path d="M8 5v14l11-7z"></path>';
    document.querySelectorAll(".prog-cell.playing").forEach(c => c.classList.remove("playing"));
  }

  function restart() {
    if (!state.isPlaying) return;
    stopPlayback();
    startPlayback();
  }

  el.playToggle.addEventListener("click", () => {
    if (state.isPlaying) stopPlayback();
    else startPlayback();
  });

  window.__qnphraseAudio = { start: startPlayback, stop: stopPlayback, restart, rebuildChordChangeMap };
})();
