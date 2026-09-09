// ============================================================
// theory.js — QNPHRASE
// 音楽理論エンジン: 音名/スケール定義、フレットボード座標変換、
// コードトーン判定、フレーズ生成アルゴリズム
// ============================================================

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 標準チューニング。低い弦(6弦)から順に。MIDI基準ではなく「半音番号」(C=0)で管理。
// 6弦E2=40, 5弦A2=45, 4弦D3=50, 3弦G3=55, 2弦B3=59, 1弦E4=64 (MIDI番号)
const TUNING_MIDI = [40, 45, 50, 55, 59, 64]; // 6弦→1弦
const STRING_LABELS = ["6", "5", "4", "3", "2", "1"];
const STRING_OPEN_NAMES = ["E", "A", "D", "G", "B", "E"];

const NUM_FRETS = 24;

// ---------- スケール定義 (ルートからの半音インターバル) ----------
const SCALES = {
  major:            { label: "Major",            intervals: [0,2,4,5,7,9,11] },
  minor:            { label: "Natural Minor",     intervals: [0,2,3,5,7,8,10] },
  majorPenta:       { label: "Major Pentatonic",  intervals: [0,2,4,7,9] },
  minorPenta:       { label: "Minor Pentatonic",  intervals: [0,3,5,7,10] },
  blues:            { label: "Blues",             intervals: [0,3,5,6,7,10] },
  dorian:           { label: "Dorian",            intervals: [0,2,3,5,7,9,10] },
  phrygian:         { label: "Phrygian",          intervals: [0,1,3,5,7,8,10] },
  lydian:           { label: "Lydian",            intervals: [0,2,4,6,7,9,11] },
  mixolydian:       { label: "Mixolydian",        intervals: [0,2,4,5,7,9,10] },
  aeolian:          { label: "Aeolian",           intervals: [0,2,3,5,7,8,10] },
  locrian:          { label: "Locrian",           intervals: [0,1,3,5,6,8,10] },
  harmonicMinor:    { label: "Harmonic Minor",    intervals: [0,2,3,5,7,8,11] },
  melodicMinor:     { label: "Melodic Minor",     intervals: [0,2,3,5,7,9,11] },
  wholeTone:        { label: "Whole Tone",        intervals: [0,2,4,6,8,10] },
  chromatic:        { label: "Chromatic",         intervals: [0,1,2,3,4,5,6,7,8,9,10,11] },
};

const SCALE_ORDER = ["random","major","minor","majorPenta","minorPenta","blues","dorian","phrygian","lydian","mixolydian","aeolian","locrian","harmonicMinor","melodicMinor","wholeTone","chromatic"];

// ---------- コード定義 (ルートからの構成音の半音インターバル) ----------
const CHORD_TYPES = {
  "":    { label: "", intervals: [0,4,7] },        // major triad
  "m":   { label: "m", intervals: [0,3,7] },
  "7":   { label: "7", intervals: [0,4,7,10] },
  "m7":  { label: "m7", intervals: [0,3,7,10] },
  "maj7":{ label: "maj7", intervals: [0,4,7,11] },
  "dim": { label: "dim", intervals: [0,3,6] },
  "aug": { label: "aug", intervals: [0,4,8] },
  "sus4":{ label: "sus4", intervals: [0,5,7] },
  "sus2":{ label: "sus2", intervals: [0,2,7] },
  "6":   { label: "6", intervals: [0,4,7,9] },
  "m6":  { label: "m6", intervals: [0,3,7,9] },
  "m7b5":{ label: "m7b5", intervals: [0,3,6,10] },
};
const CHORD_TYPE_ORDER = ["","m","7","m7","maj7","dim","aug","sus4","sus2","6","m6","m7b5"];

// ---------- ディグリー(度数)表記 ----------
// メジャースケール上の7つの度数。各度数がキーから何半音離れているか(interval)、
// 本来のダイアトニックコードの性質(デフォルトtype)、ローマ数字表記を定義する。
// これにより「キーが変わってもディグリーは同じ」という相対表記が可能になる。
const DEGREES = [
  { interval: 0,  defaultType: "",    roman: "I" },    // I (major)
  { interval: 2,  defaultType: "m",   roman: "ii" },   // ii (minor)
  { interval: 4,  defaultType: "m",   roman: "iii" },  // iii (minor)
  { interval: 5,  defaultType: "",    roman: "IV" },   // IV (major)
  { interval: 7,  defaultType: "",    roman: "V" },    // V (major)
  { interval: 9,  defaultType: "m",   roman: "vi" },   // vi (minor)
  { interval: 11, defaultType: "dim", roman: "vii°" }, // vii° (diminished)
];

// ディグリー番号(0-6) + キー(pc) から、実際のルートpcを計算する
function degreeToRootPc(degree, keyPc) {
  const def = DEGREES[degree];
  if (!def) return keyPc;
  return (keyPc + def.interval) % 12;
}

// 逆変換: 実際のルートpc + キー(pc) から、そのルートがキーの第何度に
// あたるかを返す(0-6のディグリー番号)。ダイアトニックな7音のいずれにも
// 一致しない場合(半音違いの借用和音など)はnullを返す。
function rootPcToDegree(rootPc, keyPc) {
  const diff = ((rootPc - keyPc) % 12 + 12) % 12;
  const idx = DEGREES.findIndex(d => d.interval === diff);
  return idx >= 0 ? idx : null;
}

// ディグリー番号とコードタイプから、ローマ数字表記を作る。
// 大文字/小文字でコードの長短(メジャー系/マイナー系/ディミニッシュ)を表し、
// タイプが単純な三和音("" = メジャー, "m" = マイナー, "dim" = ディミニッシュ)
// でない場合は、7th・sus4等のタイプラベルを常に付記する(例: "V7", "IVsus4", "iim7")。
function degreeToRoman(degree, chordType) {
  const def = DEGREES[degree];
  if (!def) return "?";
  chordType = chordType || "";

  // m7b5(ハーフディミニッシュ)はディミニッシュ系として扱う。他のマイナー系は
  // マイナーとして扱う。判定順序が重要: m7b5をまずディミニッシュ側で捕捉する。
  const isDimRoot = chordType === "dim" || chordType === "m7b5";
  const isMinorRoot = !isDimRoot && (chordType === "m" || chordType === "m7" || chordType === "m6");
  const isAugRoot = chordType === "aug";

  let romanBase = def.roman.replace("°", "");
  if (isDimRoot) romanBase = romanBase.toLowerCase() + "°";
  else if (isMinorRoot) romanBase = romanBase.toLowerCase();
  else if (isAugRoot) romanBase = romanBase.toUpperCase() + "+";
  else romanBase = romanBase.toUpperCase();

  // 単純な三和音("", "m", "dim", "aug")はローマ数字の大文字/小文字/記号だけで
  // 表現済みなので、タイプラベルの付記は不要。それ以外(7th, sus4, 6th等)は常に付記する。
  if (chordType === "" || chordType === "m" || chordType === "dim" || chordType === "aug") return romanBase;

  const typeLabel = CHORD_TYPES[chordType] ? CHORD_TYPES[chordType].label : "";
  return romanBase + typeLabel;
}

function noteIndex(name) {
  return NOTE_NAMES.indexOf(name);
}

function pcName(pc, preferFlat) {
  pc = ((pc % 12) + 12) % 12;
  return NOTE_NAMES[pc];
}

// 指定弦・フレットの半音番号(MIDI)
function midiAt(stringIdx, fret) {
  return TUNING_MIDI[stringIdx] + fret;
}

// 実用上のフレット上限(一般的な21フレット仕様のギターを想定)
const PLAYABLE_MAX_FRET = 21;

// 1つの音(string, fret)を半音数(semitones)ぶん移調する。
// 移調後の実音(MIDI)を求め、6本の弦それぞれで「その実音が0〜PLAYABLE_MAX_FRET
// フレットの範囲に収まるか」を調べ、最も元の弦に近い(移弦の少ない)弦を選ぶ。
// どの弦でも範囲に収まらない場合は弾ける場所が無いとみなし、playable:false を返す。
function transposeNote(stringIdx, fret, semitones) {
  const targetMidi = midiAt(stringIdx, fret) + semitones;

  // 各弦での必要フレット数を計算し、有効な(0〜上限に収まる)候補を集める
  const candidates = [];
  for (let s = 0; s < 6; s++) {
    const f = targetMidi - TUNING_MIDI[s];
    if (f >= 0 && f <= PLAYABLE_MAX_FRET) {
      candidates.push({ string: s, fret: f, stringDist: Math.abs(s - stringIdx) });
    }
  }

  if (candidates.length === 0) {
    // 弾ける弦が無い: 表示用に、元の弦のままの計算値を(範囲外を承知で)返す
    const fallbackFret = targetMidi - TUNING_MIDI[stringIdx];
    return { string: stringIdx, fret: fallbackFret, playable: false };
  }

  // 元の弦から一番近い(移弦が少ない)候補を優先し、同点なら元と同じ弦を優先する
  candidates.sort((a, b) => a.stringDist - b.stringDist);
  const best = candidates[0];
  return { string: best.string, fret: best.fret, playable: true };
}

// 半音番号 → ピッチクラス(0-11)
function pc(midi) {
  return ((midi % 12) + 12) % 12;
}

// スケール構成音のピッチクラス集合を返す
function scalePitchClasses(rootPc, scaleKey) {
  const def = SCALES[scaleKey];
  if (!def) return null;
  return def.intervals.map(iv => (rootPc + iv) % 12);
}

// 指定ピッチクラスが、キー(rootPc)とスケールに対して「スケール上の第何度か」を
// 表すラベルを返す(TAB表示のディグリー表記用)。スケール構成音であれば
// "1"〜"7"(スケールの音数に応じた番号)を返し、構成音に含まれない半音は
// 直前のスケール度数に♯を付けて近似表記する(例: "♯4")。
function pitchClassToScaleDegreeLabel(pc, rootPc, scaleKey) {
  const def = SCALES[scaleKey];
  if (!def) return "?";
  const semitoneFromRoot = ((pc - rootPc) % 12 + 12) % 12;
  const intervals = def.intervals;
  const exactIdx = intervals.indexOf(semitoneFromRoot);
  if (exactIdx !== -1) return String(exactIdx + 1);
  // スケール構成音に一致しない場合、直下のスケール音からの半音上がりとして
  // "♯<度数>" 表記にする(一番近いスケール音を探す)
  let below = null;
  for (let i = intervals.length - 1; i >= 0; i--) {
    if (intervals[i] < semitoneFromRoot) { below = i; break; }
  }
  if (below === null) {
    // オクターブをまたいで最後の音の半音上とみなす
    return "♯" + intervals.length;
  }
  return "♯" + (below + 1);
}

// コード構成音のピッチクラス集合を返す
function chordPitchClasses(rootPc, chordType) {
  const def = CHORD_TYPES[chordType] || CHORD_TYPES[""];
  return def.intervals.map(iv => (rootPc + iv) % 12);
}

// フレットボード上、指定ポジション範囲(fretMin〜fretMax)内で
// スケールに含まれる (string, fret) の一覧を返す
function scaleShapeInRange(rootPc, scaleKey, fretMin, fretMax) {
  const scalePcs = new Set(scalePitchClasses(rootPc, scaleKey));
  const positions = [];
  for (let s = 0; s < 6; s++) {
    for (let f = fretMin; f <= fretMax; f++) {
      const p = pc(midiAt(s, f));
      if (scalePcs.has(p)) {
        positions.push({ string: s, fret: f, pc: p });
      }
    }
  }
  return positions;
}

// ============================================================
// フレーズ生成
// ============================================================
//
// 入力: progression(32要素、各要素 {root: pcまたはnull, type: chordType} or null=無指定)
//       key(ルートpc), scaleKey("random"なら拍ごとにランダム選択したスケールを固定して使う),
//       fretMin, fretMax
// 出力: 32拍ぶんの配列。各拍は 0〜2個程度のノートイベント配列
//       { subdivision: "8th"|"16th", notes: [{string, fret, startStep}] }
//       stepは1拍を16分割した単位(0-15)で管理し、最終的に8分/16分混在のタイミングを作る
//
// 設計方針:
// - 1拍を16分音符4つ分のスロット(0,1,2,3)として扱う
// - 各拍ごとに「8分刻み(2音)」か「16分刻み(最大4音)」かをランダムに決め、
//   さらに休符もランダムに混ぜて偶数のべた埋めにならないようにする
// - 各スロットの音は、その拍のコードトーンを優先的に選びつつ、
//   スケール内音も混ぜることで単調なアルペジオにならないようにする
// - 前の音からできるだけ近いフレットへ跳躍を抑えて動くよう、候補から距離の近いものを優先する

function weightedPick(arr, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

// 現在の音位置から見て、次の音の「弦」をカテゴリ単位の確率で選び、
// その弦グループの中からフレット距離の近い音を優先して選ぶ。
// 弦移動の内訳: 同じ弦45% / 隣接弦(±1)45% / 弦飛び(±2まで)10%。3弦以上の跳躍は選ばない。
//
// pitchBias: -1(下降を優先)〜 +1(上昇を優先)。0は中立。
//   メロディの方向性(慣性・フレーズの弧)を反映させるためのバイアス値。
// avoidLeap: trueの場合、大きな跳躍(3半音超)の重みをさらに落とす(裏拍向け)
function pickNearestNote(candidates, prevNote, pitchBias, avoidLeap) {
  if (!prevNote) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  pitchBias = pitchBias || 0;

  // 候補を「同じ弦」「隣接弦」「弦飛び」の3グループに分類。
  // 弦飛びは最大2弦(距離2)までに制限し、3弦以上の跳躍は候補から除外する
  // (ギターの運指として現実的な範囲に収める)。
  const sameStringNotes = [];
  const adjacentStringNotes = [];
  const skipStringNotes = [];
  candidates.forEach(c => {
    const stringDist = Math.abs(c.string - prevNote.string);
    if (stringDist === 0) sameStringNotes.push(c);
    else if (stringDist === 1) adjacentStringNotes.push(c);
    else if (stringDist === 2) skipStringNotes.push(c);
    // stringDist >= 3 は候補から除外(弦飛びは最大2弦まで)
  });

  const groups = [
    { notes: sameStringNotes, weight: 0.45 },
    { notes: adjacentStringNotes, weight: 0.45 },
    { notes: skipStringNotes, weight: 0.1 },
  ].filter(g => g.notes.length > 0);

  // 全グループが空(=同じ弦・隣接弦・2弦飛びのいずれにも候補が無い)場合のみ、
  // やむを得ず全候補から選ぶ(スケール範囲が極端に狭い場合の保険)
  if (groups.length === 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const totalGroupW = groups.reduce((a, g) => a + g.weight, 0);
  let r = Math.random() * totalGroupW;
  let chosenGroup = groups[groups.length - 1];
  for (const g of groups) {
    r -= g.weight;
    if (r <= 0) { chosenGroup = g; break; }
  }

  // 前の音の実ピッチ(MIDI相当)を求める
  const prevMidi = midiAt(prevNote.string, prevNote.fret);

  // グループ内では、実ピッチ距離(半音差)が近い音・同音でない音を優先しつつ、
  // pitchBiasの方向にある音をさらに優遇する。フレット距離ではなく実ピッチ距離を
  // 基準にすることで、弦を飛んだ時に音程が不自然に跳躍するのを防ぐ。
  const scored = chosenGroup.notes.map(c => {
    const isSameNote = c.string === prevNote.string && c.fret === prevNote.fret;
    const cMidi = midiAt(c.string, c.fret);
    const pitchDelta = cMidi - prevMidi; // 正=上昇、負=下降
    const pitchDist = Math.abs(pitchDelta);

    let weight = 1 / (pitchDist * 0.55 + 1.0);
    if (isSameNote) weight *= 0.15;

    // スケール上の隣接音(1〜2半音差=全音/半音の順次進行)を強く優遇する。
    // 人間らしいメロディは大半が隣接スケール音への移動でできているため。
    if (!isSameNote && pitchDist >= 1 && pitchDist <= 2) weight *= 2.6;

    // 方向性バイアス: pitchBiasと同じ符号の音を優遇
    if (pitchBias > 0.05 && pitchDelta > 0) weight *= (1 + pitchBias * 1.8);
    else if (pitchBias < -0.05 && pitchDelta < 0) weight *= (1 + Math.abs(pitchBias) * 1.8);
    else if (pitchBias > 0.05 && pitchDelta < 0) weight *= 0.55; // 逆方向はやや抑制
    else if (pitchBias < -0.05 && pitchDelta > 0) weight *= 0.55;

    // 裏拍は大きな跳躍(5半音超)をさらに抑制して順次進行寄りにする
    if (avoidLeap && pitchDist > 5) weight *= 0.25;
    // 強拍でも極端な跳躍(1オクターブ超)は起こりにくくする
    if (pitchDist > 12) weight *= 0.3;

    return { note: c, weight, pitchDelta };
  });
  const totalW = scored.reduce((a, s) => a + s.weight, 0);
  let r2 = Math.random() * totalW;
  for (const s of scored) {
    r2 -= s.weight;
    if (r2 <= 0) return s.note;
  }
  return scored[scored.length - 1].note;
}

// 1拍分のリズムパターンを生成: 16分スロット(0-3)のうちどこに音を置くか
// 8分中心・16分混在、休符もあり
function generateBeatRhythm() {
  const patterns = [
    { slots: [0, 2], weight: 5 },              // 8分音符2つ (基本形)
    { slots: [0, 1, 2, 3], weight: 3 },        // 16分4つ
    { slots: [0], weight: 3 },                  // 4分音符1つ
    { slots: [0, 1, 2], weight: 2 },            // 16分3つ(付点っぽい)
    { slots: [0, 2, 3], weight: 2 },            // シンコペーション気味
    { slots: [], weight: 1 },                   // 休符(何も弾かない)
    { slots: [1, 2], weight: 1 },               // 裏から
    { slots: [0, 1, 2, 3].filter((_, i) => i !== 2), weight: 1 }, // 抜け
  ];
  const arr = patterns.map(p => p.slots);
  const weights = patterns.map(p => p.weight);
  return weightedPick(arr, weights);
}

// コード情報から実際のルートpcと種類を得る(未指定拍は前の指定を引き継ぐ)
function resolveProgression(progression) {
  const resolved = [];
  let last = null;
  for (let i = 0; i < progression.length; i++) {
    const cell = progression[i];
    if (cell && cell.root !== null && cell.root !== undefined) {
      last = cell;
    }
    resolved.push(last);
  }
  return resolved;
}

// resolveProgressionの結果から「コードが変化した拍」のみを抽出し、
// 各変化点について何拍分そのコードが続くか(durationBeats)を付与する。
// 再生時、この情報を使って「コードが変わった瞬間だけ音を出し、それ以外は
// 前の音をそのまま伸ばす(=鳴らさない)」を実現する。
function resolveChordChanges(progression) {
  const resolved = resolveProgression(progression);
  const changes = [];
  for (let i = 0; i < resolved.length; i++) {
    const chord = resolved[i];
    if (!chord) continue;
    const prev = i > 0 ? resolved[i - 1] : null;
    const isChange = !prev || prev.root !== chord.root || prev.type !== chord.type;
    if (isChange) {
      changes.push({ beatIdx: i, root: chord.root, type: chord.type, durationBeats: 1 });
    } else if (changes.length > 0) {
      changes[changes.length - 1].durationBeats++;
    }
  }
  return changes;
}

// フレーズ全体に「弧」を与えるための小節単位の輪郭パターンを生成する。
// 各小節に "asc"(上昇) / "desc"(下降) / "arch"(山型:前半上昇後半下降) /
// "valley"(谷型:前半下降後半上昇) のいずれかをランダムに割り当てる。
// 人間が弾くメロディは無方向のランダムウォークではなく、こうした緩やかな
// 輪郭を持つことが多いため、これを土台にpitchBiasを決める。
function generateBarContours(numBars) {
  const shapes = ["asc", "desc", "arch", "valley"];
  const contours = [];
  for (let i = 0; i < numBars; i++) {
    contours.push(shapes[Math.floor(Math.random() * shapes.length)]);
  }
  return contours;
}

// 小節内の位置(0〜1)と輪郭タイプから、その時点でのpitchBias(-1〜1)を求める
function biasForContour(contour, posInBar) {
  switch (contour) {
    case "asc": return 0.6;
    case "desc": return -0.6;
    case "arch": return posInBar < 0.5 ? 0.6 : -0.6;
    case "valley": return posInBar < 0.5 ? -0.6 : 0.6;
    default: return 0;
  }
}

// メイン生成関数
// progression: numBeats要素配列 (各 {root: pc(0-11), type: "m" 等} or null)
// options: { key: pc, scaleKey, fretMin, fretMax }
function generatePhrase(progression, options) {
  const { fretMin, fretMax } = options;
  const numBeats = progression.length;
  const numBars = numBeats / 4;
  const resolvedProg = resolveProgression(progression);
  const beats = [];
  let prevNote = null;

  // フレーズ全体の輪郭(小節ごとの上昇/下降/山/谷)を先に決めておく
  const barContours = generateBarContours(numBars);
  // 方向性の慣性: 直前に選んだ方向を保持し、次の判断に弱く影響させる
  let momentum = 0; // -1(下降継続中)〜 +1(上昇継続中)

  for (let i = 0; i < numBeats; i++) {
    const barIdx = Math.floor(i / 4);
    const posInBar = (i % 4) / 4;
    const isFirstBeatOfBar = (i % 4) === 0;
    const isLastBeatOfBar = (i % 4) === 3;

    const chord = resolvedProg[i];
    let scaleKey = options.scaleKey;
    if (scaleKey === "random") {
      // ランダムモード: フレーズ全体で1つのスケールをランダムに固定（拍ごとに変えると無調になりすぎるため）
      if (!options._resolvedRandomScale) {
        const candidates = SCALE_ORDER.filter(s => s !== "random");
        options._resolvedRandomScale = candidates[Math.floor(Math.random() * candidates.length)];
      }
      scaleKey = options._resolvedRandomScale;
    }

    if (!chord) {
      beats.push({ notes: [] });
      continue;
    }

    const rootPc = chord.root;
    const chordType = chord.type || "";
    const chordTones = new Set(chordPitchClasses(rootPc, chordType));
    const scalePositions = scaleShapeInRange(rootPc, scaleKey, fretMin, fretMax);

    if (scalePositions.length === 0) {
      beats.push({ notes: [] });
      continue;
    }

    // コードトーンとそれ以外に分ける
    const chordTonePositions = scalePositions.filter(p => chordTones.has(p.pc));
    const passingPositions = scalePositions;

    // コードトーンに「隣接」する非コードトーン(パッシングトーン)だけを集めたプール。
    // ブルーススケール等、コードトーンでない音がスケール内に多く含まれる場合でも、
    // コードトーンから1〜2半音以内の位置からしか経過音が選ばれないようにすることで、
    // 「突拍子もない位置でコードトーンを外れる」ことを防ぎ、経過音らしい自然な動きにする。
    const chordTonePcs = new Set(chordTones);
    const nonChordTonePositions = scalePositions.filter(p => !chordTonePcs.has(p.pc));
    const adjacentToChordTonePositions = nonChordTonePositions.filter(p => {
      // このパッシングトーン候補pのピッチクラスが、いずれかのコードトーンのピッチクラスから
      // 1〜2半音以内にあるかを判定する
      for (const tonePc of chordTonePcs) {
        const diff = Math.min(
          ((p.pc - tonePc) % 12 + 12) % 12,
          ((tonePc - p.pc) % 12 + 12) % 12
        );
        if (diff >= 1 && diff <= 2) return true;
      }
      return false;
    });
    // 隣接パッシングトーンが1つも無い場合(理論上ほぼ無いが保険として)は、
    // 従来通りスケール全体から選べるようにフォールバックする
    const nonChordTonePool = adjacentToChordTonePositions.length > 0 ? adjacentToChordTonePositions : passingPositions;

    const rhythmSlots = generateBeatRhythm();
    const notes = [];

    rhythmSlots.forEach((slot, idx) => {
      const isDownbeat = slot === 0; // 拍の頭(強拍)
      const isBarHead = isFirstBeatOfBar && isDownbeat; // 小節の頭(最強拍)
      const isLastSlotOfBar = isLastBeatOfBar && idx === rhythmSlots.length - 1;

      // 小節の頭(1拍目の頭)はほぼ必ずコードトーンに、それ以外の拍の頭は
      // やや高めの確率でコードトーンを優先する。裏拍は下のavoidLeapと
      // pickNearestNote側の隣接音優遇によって、スケール上の隣の音へなめらかに繋がりやすい。
      let chordToneChance;
      if (isBarHead) chordToneChance = 0.95;
      else if (isDownbeat) chordToneChance = 0.7;
      else chordToneChance = 0;

      const pool = (chordTonePositions.length > 0 && Math.random() < chordToneChance)
        ? chordTonePositions
        : nonChordTonePool;

      // このタイミングでの目標pitchBias = 小節の輪郭バイアス + 直前の慣性を弱くブレンド
      const contourBias = biasForContour(barContours[barIdx], posInBar + idx / (rhythmSlots.length * 4));
      let pitchBias = contourBias * 0.6 + momentum * 0.4;

      // 小節の最後の音は、そのコードのルート/3rd/5thに着地させて「まとまり」を出す
      let finalPool = pool;
      if (isLastSlotOfBar && chordTonePositions.length > 0) {
        finalPool = chordTonePositions;
      }

      // 裏拍(slot!==0)は大きな跳躍を避けて順次進行寄りにする
      const avoidLeap = !isDownbeat;

      const note = pickNearestNote(finalPool, prevNote, pitchBias, avoidLeap);

      // 実際に上昇/下降どちらに動いたかを慣性に反映(次の音の判断に弱く影響)
      if (prevNote) {
        const delta = midiAt(note.string, note.fret) - midiAt(prevNote.string, prevNote.fret);
        if (delta > 0) momentum = Math.min(1, momentum * 0.5 + 0.5);
        else if (delta < 0) momentum = Math.max(-1, momentum * 0.5 - 0.5);
        // delta===0(同音)の場合は慣性を維持
      }

      notes.push({ string: note.string, fret: note.fret, slot, isChordTone: chordTonePcs.has(note.pc) });
      prevNote = note;
    });

    beats.push({ notes });
  }

  attachDurations(beats);
  return beats;
}

// 各ノートに「次のノートが鳴るまでのステップ数」を付与する(サステイン音色用)。
// ループ再生を想定し、最後のノートは先頭のノートに戻るまでの長さとする。
// コードトーンでない経過音は、次のコードトーンまで長く伸ばすと不安定な音が
// 居座って聞こえて気持ち悪いため、短く切り詰めて「通過する感じ」を出す。
function attachDurations(beats) {
  const flat = [];
  beats.forEach((beat, beatIdx) => {
    beat.notes.forEach(note => {
      flat.push({ note, globalStep: beatIdx * 4 + note.slot });
    });
  });
  const totalSteps = beats.length * 4;
  if (flat.length === 0) return;
  flat.sort((a, b) => a.globalStep - b.globalStep);
  const PASSING_TONE_MAX_STEPS = 2; // 経過音は最大でも8分音符相当までしか伸ばさない
  for (let i = 0; i < flat.length; i++) {
    const cur = flat[i];
    const next = flat[(i + 1) % flat.length];
    let diff = next.globalStep - cur.globalStep;
    if (diff <= 0) diff += totalSteps; // ループを跨ぐ場合
    if (cur.note.isChordTone === false) {
      diff = Math.min(diff, PASSING_TONE_MAX_STEPS);
    }
    cur.note.durationSteps = diff;
  }
}

// フレーズ全体(beats配列)を半音数(semitones)ぶん一括で移調する。
// 各ノートをtransposeNoteで移調し、弾ける場所が無い場合はplayable:falseを
// フラグとして残す(TAB描画側で"!"表記にするため)。durationSteps等の
// 他プロパティは維持したまま、string/fretだけを書き換える。
function transposePhrase(beats, semitones) {
  if (!semitones) return beats;
  return beats.map(beat => ({
    notes: beat.notes.map(note => {
      const result = transposeNote(note.string, note.fret, semitones);
      return Object.assign({}, note, {
        string: result.string,
        fret: result.fret,
        playable: result.playable,
      });
    }),
  }));
}

