// ============================================================
// qn-nav.js
// QNシリーズ ヘッダーナビゲーション（共通・独立ファイル）
//
// ヘッダー右上（SP幅ではハンバーガーメニュー内）に並ぶ
// PLAYER / TUNER / TEMPO アイコン。現在開いているアプリ自身への
// リンクだけ非活性化する（他の2つは常にクリック可能）。
//
// もともとは player-ui-shared.js の末尾にあったブロックだが、
// player-ui-shared.js にはQNPLAYER固有の処理（音量保存・テーマ切替・
// グロー設定・プレイリストのIndexedDB復元など）が多数含まれており、
// QNTUNER/QNTEMPO側でそのまま丸ごと読み込むと、各アプリの同名要素
// （fileInput 等）と衝突する危険があるため、このナビ機能だけを
// 独立ファイルとして切り出した。
//
// 【使い方】
// 1. 各アプリの index.html から、この qn-nav.js を読み込む。
//    （他のscriptタグと同じ並びでよい。DOMContentLoaded後に実行される
//     ため、他スクリプトより先に読み込んでも問題ない）
//      <script src="qn-nav.js"></script>
// 2. 下の CURRENT_QN_APP を、そのアプリ用の値に変更する。
//      "player" → QNPLAYER配布用
//      "tuner"  → QNTUNER配布用
//      "tempo"  → QNTEMPO配布用
// 3. HTML側に .qn-nav-btn クラスを持つリンク（PLAYER/TUNER/TEMPOへの
//    導線、各 data-qn-app="player|tuner|tempo" 属性付き）を用意しておく。
//    このJSは「現在地のボタンを無効化する」役割のみを担い、
//    ボタン自体のマークアップ・見た目（CSS）はここでは作らない。
// ============================================================
(function () {
  const CURRENT_QN_APP = "phrase"; // player / tuner / tempo のいずれか。アプリごとにここだけ変更する

  function disableCurrentNavLink() {
    document.querySelectorAll(".qn-nav-btn").forEach(btn => {
      if (btn.dataset.qnApp === CURRENT_QN_APP) {
        btn.classList.add("current");
        btn.removeAttribute("href");
        btn.setAttribute("aria-disabled", "true");
        btn.addEventListener("click", e => e.preventDefault());
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", disableCurrentNavLink);
  } else {
    disableCurrentNavLink();
  }
})();
