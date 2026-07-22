# YouTube Live Danmaku

<p align="center">
  Turn YouTube live chat into configurable danmaku directly over the video.
</p>

<p align="center">
  <a href="#readme-zh-cn">简体中文</a> ·
  <a href="#readme-en">English</a> ·
  <a href="#readme-ja">日本語</a> ·
  <a href="#readme-ko">한국어</a>
</p>

---

<a id="readme-zh-cn"></a>

## 简体中文

一个适用于 Chrome、Edge、Brave 等 Chromium 桌面浏览器的 Manifest V3 扩展。它读取 YouTube 页面已经加载的直播聊天或聊天回放，并将评论以弹幕形式显示在播放器上方。评论处理在页面本地完成，无需额外服务。

### 功能亮点

- 实时滚动弹幕，支持暂停、继续、快进、快退和拖动进度同步。
- 可调显示区域、不透明度、字号、速度、字体、粗体和描边。
- 保留普通表情与会员表情，并显示付费评论的页面颜色。
- 频道主和房管评论带身份标签，并在轨道拥挤时优先显示。
- 相同普通评论从第三条开始合并为居中计数弹幕，减少刷屏。
- 可在全屏时隐藏侧边评论栏，同时保持聊天 iframe 继续加载评论。
- 单 Canvas 与离屏缓存渲染，减少高密度弹幕带来的 DOM 开销。
- 设置通过 `chrome.storage.sync` 保存；扩展界面支持中文、日文、韩文和英文。

### 安装

项目没有第三方 npm 依赖。安装 Node.js 后运行：

```bash
npm run build
```

然后：

1. 打开 `chrome://extensions`、`edge://extensions` 或对应浏览器的扩展管理页。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，并选择构建生成的 `dist/`。
4. 打开带有直播聊天或聊天回放的 YouTube 视频。
5. 点击播放器控制栏右侧的弹幕设置按钮。

### 开发与测试

```bash
npm test
npm run build
```

源码位于 `src/`，零依赖构建脚本位于 `scripts/build.js`，自动测试位于 `tests/`。完整的功能、架构、权限、隐私和限制说明见 [README2.md](README2.md)。

### 隐私与限制

扩展仅请求 YouTube 站点访问权限和 `storage` 权限。评论不会发送到项目自有服务器；同步设置可能由浏览器账号的同步服务跨设备保存。只有页面实际提供直播聊天或聊天回放 iframe 时才有弹幕来源，YouTube 页面结构变化也可能需要后续适配。

### 许可

仓库当前尚未包含独立的 `LICENSE` 文件。发布、修改或再分发前，请先向项目维护者确认许可条件。

<p align="right"><a href="#youtube-live-danmaku">返回顶部</a></p>

---

<a id="readme-en"></a>

## English

A Manifest V3 extension for Chromium-based desktop browsers such as Chrome, Edge, and Brave. It reads the live chat or chat replay already loaded by YouTube and renders the messages as danmaku over the video player. Message processing happens locally in the page and requires no additional service.

### Highlights

- Real-time scrolling danmaku synchronized with pause, resume, seeking, fast-forward, and rewind.
- Configurable display area, opacity, font size, speed, font, bold text, and outline width.
- Preserves standard and member emoji and uses the page-provided color for paid messages.
- Labels channel owners and moderators and prioritizes their messages when lanes are crowded.
- Merges the third and later identical viewer messages into a centered counter to reduce flooding.
- Can hide the side chat in fullscreen while keeping the chat iframe active and receiving messages.
- Uses one main Canvas with per-message offscreen caches to reduce DOM overhead under heavy load.
- Saves preferences with `chrome.storage.sync`; the extension UI supports Chinese, Japanese, Korean, and English.

### Installation

The project has no third-party npm dependencies. Install Node.js and run:

```bash
npm run build
```

Then:

1. Open `chrome://extensions`, `edge://extensions`, or your browser's extension page.
2. Enable Developer mode.
3. Choose “Load unpacked” and select the generated `dist/` directory.
4. Open a YouTube video with live chat or chat replay.
5. Click the danmaku settings button on the right side of the player controls.

### Development and testing

```bash
npm test
npm run build
```

Source files are in `src/`, the dependency-free build script is `scripts/build.js`, and automated tests are in `tests/`. See [README2.md](README2.md) for the complete feature, architecture, permission, privacy, and limitation notes (Chinese).

### Privacy and limitations

The extension requests only YouTube host access and the `storage` permission. Chat messages are not sent to a server operated by this project; synced preferences may be stored across devices by the browser account's sync service. Danmaku is available only when the page provides a live-chat or chat-replay iframe, and future YouTube DOM changes may require compatibility updates.

### License

This repository currently does not contain a standalone `LICENSE` file. Please confirm the licensing terms with the maintainer before publishing, modifying, or redistributing the code.

<p align="right"><a href="#youtube-live-danmaku">Back to top</a></p>

---

<a id="readme-ja"></a>

## 日本語

Chrome、Edge、Brave などの Chromium 系デスクトップブラウザー向け Manifest V3 拡張機能です。YouTube ページに読み込まれたライブチャットまたはチャットリプレイを取得し、動画プレーヤー上に弾幕として表示します。コメントの処理はページ内でローカルに行われ、追加のサービスは必要ありません。

### 主な機能

- 一時停止、再開、シーク、早送り、巻き戻しに同期するリアルタイムスクロール弾幕。
- 表示範囲、不透明度、文字サイズ、速度、フォント、太字、縁取り幅を調整可能。
- 通常絵文字とメンバー絵文字を保持し、スーパーチャットにはページ上の色を使用。
- チャンネル所有者とモデレーターにラベルを付け、レーン混雑時も優先表示。
- 同じ一般コメントは 3 件目以降を中央のカウンター表示にまとめ、連投を抑制。
- 全画面時にサイドチャットを隠しても、チャット iframe は動作を続けてコメントを取得。
- 単一のメイン Canvas とコメント単位のオフスクリーンキャッシュで、高負荷時の DOM コストを削減。
- 設定は `chrome.storage.sync` に保存。拡張機能 UI は中国語、日本語、韓国語、英語に対応。

### インストール

サードパーティーの npm 依存関係はありません。Node.js をインストールして、次を実行します。

```bash
npm run build
```

その後：

1. `chrome://extensions`、`edge://extensions`、またはブラウザーの拡張機能管理ページを開きます。
2. デベロッパーモードを有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」を選び、生成された `dist/` を指定します。
4. ライブチャットまたはチャットリプレイのある YouTube 動画を開きます。
5. プレーヤー操作部の右側にある弾幕設定ボタンをクリックします。

### 開発とテスト

```bash
npm test
npm run build
```

ソースは `src/`、依存関係のないビルドスクリプトは `scripts/build.js`、自動テストは `tests/` にあります。全機能、アーキテクチャ、権限、プライバシー、制限事項については [README2.md](README2.md)（中国語）を参照してください。

### プライバシーと制限事項

要求するのは YouTube のホストアクセス権限と `storage` 権限だけです。チャット内容が本プロジェクトのサーバーへ送信されることはありませんが、同期設定はブラウザーアカウントの同期サービスによりデバイス間で保存される場合があります。ページにライブチャットまたはチャットリプレイ iframe がある場合のみ利用でき、YouTube の DOM 変更により将来の対応が必要になることがあります。

### ライセンス

現在、このリポジトリには独立した `LICENSE` ファイルがありません。公開、変更、再配布を行う前に、ライセンス条件をメンテナーへ確認してください。

<p align="right"><a href="#youtube-live-danmaku">トップへ戻る</a></p>

---

<a id="readme-ko"></a>

## 한국어

Chrome, Edge, Brave 등 Chromium 기반 데스크톱 브라우저용 Manifest V3 확장 프로그램입니다. YouTube 페이지에 이미 로드된 실시간 채팅 또는 채팅 다시보기를 읽어 동영상 플레이어 위에 탄막으로 표시합니다. 댓글 처리는 페이지 안에서 로컬로 수행되며 별도 서비스가 필요하지 않습니다.

### 주요 기능

- 일시 정지, 재생, 탐색, 빨리 감기, 되감기에 동기화되는 실시간 스크롤 탄막.
- 표시 영역, 불투명도, 글자 크기, 속도, 글꼴, 굵기, 외곽선 두께 설정.
- 일반 및 멤버 이모지를 유지하고 유료 메시지에는 페이지에서 제공한 색상을 사용.
- 채널 소유자와 관리자를 라벨로 표시하고 레인이 혼잡할 때 우선 출력.
- 동일한 일반 댓글은 세 번째부터 중앙 카운터로 합쳐 도배를 줄임.
- 전체 화면에서 사이드 채팅을 숨겨도 채팅 iframe은 계속 동작하며 댓글을 수신.
- 하나의 메인 Canvas와 댓글별 오프스크린 캐시를 사용해 고밀도 상황의 DOM 부하를 절감.
- `chrome.storage.sync`로 설정 저장. 확장 프로그램 UI는 중국어, 일본어, 한국어, 영어 지원.

### 설치

서드파티 npm 의존성이 없습니다. Node.js를 설치한 뒤 다음 명령을 실행합니다.

```bash
npm run build
```

그다음:

1. `chrome://extensions`, `edge://extensions` 또는 브라우저의 확장 프로그램 관리 페이지를 엽니다.
2. 개발자 모드를 켭니다.
3. “압축해제된 확장 프로그램을 로드합니다”를 선택하고 생성된 `dist/` 폴더를 지정합니다.
4. 실시간 채팅 또는 채팅 다시보기가 있는 YouTube 동영상을 엽니다.
5. 플레이어 컨트롤 오른쪽의 탄막 설정 버튼을 누릅니다.

### 개발 및 테스트

```bash
npm test
npm run build
```

소스는 `src/`, 의존성 없는 빌드 스크립트는 `scripts/build.js`, 자동 테스트는 `tests/`에 있습니다. 전체 기능, 구조, 권한, 개인정보 보호 및 제한 사항은 [README2.md](README2.md)(중국어)를 참고하세요.

### 개인정보 보호 및 제한 사항

확장 프로그램은 YouTube 호스트 접근 권한과 `storage` 권한만 요청합니다. 채팅 메시지는 이 프로젝트가 운영하는 서버로 전송되지 않지만, 동기화된 설정은 브라우저 계정의 동기화 서비스를 통해 여러 기기에 저장될 수 있습니다. 페이지에 실시간 채팅 또는 채팅 다시보기 iframe이 있을 때만 탄막을 표시할 수 있으며, 향후 YouTube DOM 변경에 따라 호환성 업데이트가 필요할 수 있습니다.

### 라이선스

현재 이 저장소에는 별도의 `LICENSE` 파일이 없습니다. 코드를 게시, 수정 또는 재배포하기 전에 관리자에게 라이선스 조건을 확인해 주세요.

<p align="right"><a href="#youtube-live-danmaku">맨 위로</a></p>
