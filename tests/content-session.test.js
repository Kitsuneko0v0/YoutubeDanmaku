'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../src/content.css'), 'utf8');
const window = {
  addEventListener() {}
};
window.top = window;

const location = {
  href: 'https://www.youtube.com/',
  hostname: 'example.invalid',
  origin: 'https://www.youtube.com',
  pathname: '/'
};
const context = vm.createContext({
  URL,
  clearTimeout,
  console,
  location,
  setTimeout,
  window
});
vm.runInContext(source, context, { filename: 'content.js' });

const {
  ChatFrameBridge,
  getVideoIdFromUrl,
  isValidChatMessagePayload,
  normalizeSettings,
  parseChatReplayTimestamp,
  YouTubeDanmakuApp
} = context.YTDanmakuExtension;

assert.equal(parseChatReplayTimestamp('4:03:01'), 14581, '回放聊天时间应解析为视频秒数');
assert.equal(parseChatReplayTimestamp('03:01'), 181, '短于一小时的回放时间也应正确解析');
assert.equal(parseChatReplayTimestamp('直播中'), null, '非回放时间文本不应被误解析');
assert.match(
  source,
  /this\.observer\.observe\(list, \{ childList: true, subtree: false \}\)/,
  '聊天列表观察器应只监听直接子元素，避免内部 DOM 变化反复触发解析'
);
assert.doesNotMatch(source, /bodyObserver/, '聊天桥接不应再观察整个聊天文档子树');

context.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
const bridgePosts = [];
window.postMessage = (message) => {
  bridgePosts.push(message);
};
const createFakeChatRenderer = (id, text, timestamp) => {
  const messageElement = {
    childNodes: [{ nodeType: context.Node.TEXT_NODE, textContent: text }]
  };
  return {
    id,
    nodeType: context.Node.ELEMENT_NODE,
    getAttribute() {
      return null;
    },
    matches(selector) {
      return selector.includes('yt-live-chat-text-message-renderer');
    },
    querySelector(selector) {
      if (selector === '#message, #header-subtext') return messageElement;
      if (selector === '#author-name') return { textContent: 'viewer' };
      if (selector === '#timestamp') return { textContent: timestamp };
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
};
const bridge = new ChatFrameBridge();
bridge.now = () => 0;
bridge.scheduleDrain = () => {};
for (let index = 0; index < 5; index += 1) {
  bridge.queueRenderer(createFakeChatRenderer(
    `bridge-${index}`,
    `分片评论 ${index}`,
    `4:03:0${index}`
  ));
}
assert.equal(bridge.pendingWork.length, 5, 'MutationObserver 收集阶段不应同步解析评论');
assert.equal(bridgePosts.length, 0, '收集新增节点时不应逐条发送 postMessage');
bridge.drainQueue();
bridge.drainQueue();
bridge.drainQueue();
assert.deepEqual(
  bridgePosts.map((message) => message.payloads.length),
  [2, 2, 1],
  '聊天评论应按每批最多两条分片解析并批量发送'
);
assert.ok(
  bridgePosts.every((message) => message.type === 'chat-message-batch'),
  '聊天 iframe 应使用批量消息协议减少跨窗口事件数量'
);
assert.equal(bridge.pendingWork.length, 0, '所有分片最终都应完整排空');

let delayedRendererReady = false;
const delayedRenderer = createFakeChatRenderer('bridge-delayed', '延迟填充评论', '4:03:05');
const delayedQuerySelector = delayedRenderer.querySelector.bind(delayedRenderer);
delayedRenderer.isConnected = true;
delayedRenderer.querySelector = (selector) => {
  if (selector === '#message, #header-subtext' && !delayedRendererReady) return null;
  return delayedQuerySelector(selector);
};
bridge.queueRenderer(delayedRenderer);
bridge.drainQueue();
assert.equal(bridge.pendingWork.length, 1, '尚未填充内容的 renderer 应延后到下一任务重试');
delayedRendererReady = true;
bridge.drainQueue();
assert.equal(bridgePosts.at(-1).payloads[0].id, 'bridge-delayed', '延迟填充的评论最终不应丢失');

assert.equal(
  getVideoIdFromUrl('https://www.youtube.com/watch?v=current-video&t=30'),
  'current-video',
  '观看页 URL 应提取当前视频 ID'
);
assert.equal(
  getVideoIdFromUrl('https://www.youtube.com/live_chat?v=chat-video'),
  'chat-video',
  '聊天 iframe URL 应提取所属视频 ID'
);
assert.equal(
  getVideoIdFromUrl('https://www.youtube.com/live/_POT8Ktt4Ro'),
  '_POT8Ktt4Ro',
  '/live/<id> 页面应从路径提取视频 ID'
);
assert.equal(
  getVideoIdFromUrl('https://www.youtube.com/shorts/short-video'),
  'short-video',
  'Shorts 链接应从路径提取视频 ID'
);
assert.equal(
  getVideoIdFromUrl('https://www.youtube.com/embed/embed-video'),
  'embed-video',
  '嵌入链接应从路径提取视频 ID'
);
assert.equal(
  getVideoIdFromUrl('https://youtu.be/short-link-video'),
  'short-link-video',
  'youtu.be 短链接应从路径提取视频 ID'
);
assert.equal(getVideoIdFromUrl('http://[invalid'), '', '无效 URL 不应产生视频 ID');

const rightControls = {};
const video = {};
const player = {
  querySelector(selector) {
    if (selector === '.ytp-right-controls') return rightControls;
    if (selector === 'video') return video;
    return null;
  }
};
const chatSource = {};
context.document = {
  getElementById(id) {
    return id === 'movie_player' ? player : null;
  },
  querySelectorAll() {
    return [];
  }
};

const normalizedSettings = normalizeSettings({
  area: 999,
  opacity: -20,
  fontSize: 'invalid',
  speed: 1.26,
  fontFamily: 'url(https://example.invalid/font)',
  bold: 'false',
  hideChatInFullscreen: 'true',
  strokeWidth: 3.7
});
assert.equal(normalizedSettings.area, 100, '显示区域应限制在设置面板支持的范围内');
assert.equal(normalizedSettings.opacity, 0, '不透明度应限制在设置面板支持的范围内');
assert.equal(normalizedSettings.fontSize, 24, '无效字号应回退到默认值');
assert.equal(normalizedSettings.speed, 1.3, '速度应按设置面板步长规范化');
assert.equal(normalizedSettings.fontFamily, 'sans-serif', '未知字体设置应回退到默认字体');
assert.equal(normalizedSettings.bold, false, '非布尔粗体设置不应被当作已启用');
assert.equal(
  normalizedSettings.hideChatInFullscreen,
  false,
  '非布尔全屏评论栏设置不应被当作已启用'
);
assert.equal(normalizedSettings.strokeWidth, 3.5, '描边应按设置面板步长规范化');

const hiddenChatRule = styles.match(
  /html\.yd-hide-chat-in-fullscreen ytd-watch-flexy\[fullscreen]\[live-chat-present-and-expanded] #panels-full-bleed-container\s*{([^}]*)}/
)?.[1] || '';
assert.match(hiddenChatRule, /position:\s*fixed/, '全屏评论栏应脱离播放器的横向布局');
assert.match(hiddenChatRule, /right:\s*0/, '隐藏的评论栏应保留在浏览器视口内');
assert.match(
  hiddenChatRule,
  /width:\s*var\(--ytd-watch-flexy-sidebar-width, 400px\)/,
  '移出布局后仍应保留评论栏宽度以维持 iframe 运行'
);
assert.doesNotMatch(hiddenChatRule, /display:\s*none/, '隐藏评论栏不应卸载或关闭聊天 iframe');
assert.doesNotMatch(hiddenChatRule, /visibility:\s*hidden/, '隐藏评论栏不应暂停 iframe 的可见内容更新');
assert.doesNotMatch(hiddenChatRule, /opacity:\s*0/, '隐藏评论栏不应通过透明度暂停 iframe 绘制');
assert.doesNotMatch(hiddenChatRule, /left:\s*100vw/, '隐藏评论栏不应移出浏览器视口');

const hiddenWatchGridChatRule = styles.match(
  /html\.yd-hide-chat-in-fullscreen ytd-watch-grid\[fullscreen]\[live-chat-present-and-expanded] #fixed-secondary\s*{([^}]*)}/
)?.[1] || '';
assert.match(
  hiddenWatchGridChatRule,
  /z-index:\s*0/,
  '新版全屏评论栏应保留在播放器后方'
);
assert.match(
  hiddenWatchGridChatRule,
  /width:\s*calc\(var\(--ytd-watch-flexy-sidebar-width, 402px\) \+ 8px\)/,
  '新版评论栏移出布局后仍应保留 iframe 宽度'
);
assert.doesNotMatch(
  hiddenWatchGridChatRule,
  /display:\s*none/,
  '新版全屏评论栏也不应卸载或关闭聊天 iframe'
);
assert.doesNotMatch(
  hiddenWatchGridChatRule,
  /visibility:\s*hidden|opacity:\s*0|left:\s*100vw/,
  '新版全屏评论栏应保持可见状态和视口内位置'
);

const watchGridSpacerRule = styles.match(
  /html\.yd-hide-chat-in-fullscreen ytd-watch-grid\[fullscreen]\[live-chat-present-and-expanded] #squeezeback-constraining-container\s*{([^}]*)}/
)?.[1] || '';
assert.match(watchGridSpacerRule, /flex:\s*0 0 0/, '新版全屏布局不应继续保留评论栏空间');
assert.match(watchGridSpacerRule, /width:\s*0/, '新版全屏评论栏占位宽度应收缩为零');

const fullscreenPlayerRule = styles.match(
  /html\.yd-hide-chat-in-fullscreen ytd-watch-flexy\[fullscreen]\[live-chat-present-and-expanded] #player-full-bleed-container,\s*html\.yd-hide-chat-in-fullscreen ytd-watch-grid\[fullscreen]\[live-chat-present-and-expanded] #player-full-bleed-container\s*{([^}]*)}/
)?.[1] || '';
assert.match(fullscreenPlayerRule, /z-index:\s*1/, '播放器应覆盖仍在视口内运行的评论栏');

const documentClassNames = new Set();
context.document.documentElement = {
  classList: {
    toggle(name, force) {
      if (force) documentClassNames.add(name);
      else documentClassNames.delete(name);
    },
    remove(name) {
      documentClassNames.delete(name);
    }
  }
};
const fullscreenApp = new YouTubeDanmakuApp();
let chatReplayRefreshes = 0;
fullscreenApp.scheduleChatReplayRefresh = () => {
  chatReplayRefreshes += 1;
};
fullscreenApp.player = {
  classList: { contains: (name) => name === 'ytp-fullscreen' },
  contains: () => false
};
fullscreenApp.settings.hideChatInFullscreen = false;
fullscreenApp.updateChatVisibility();
assert.equal(
  documentClassNames.has('yd-hide-chat-in-fullscreen'),
  false,
  '默认设置应保留 YouTube 原有的全屏评论栏逻辑'
);
fullscreenApp.settings.hideChatInFullscreen = true;
fullscreenApp.updateChatVisibility();
assert.equal(
  documentClassNames.has('yd-hide-chat-in-fullscreen'),
  true,
  '开启设置后应在全屏时隐藏评论栏'
);
fullscreenApp.player.classList.contains = () => false;
fullscreenApp.updateChatVisibility();
assert.equal(
  documentClassNames.has('yd-hide-chat-in-fullscreen'),
  false,
  '退出全屏后应恢复评论栏'
);
assert.equal(chatReplayRefreshes, 1, '退出全屏后应触发一次聊天回放同步');

const replayRefreshApp = new YouTubeDanmakuApp();
replayRefreshApp.settings.hideChatInFullscreen = true;
replayRefreshApp.chatRefreshPending = true;
replayRefreshApp.video = { paused: false, currentTime: 30, duration: 120 };
replayRefreshApp.refreshChatReplay();
assert.ok(
  Math.abs(replayRefreshApp.video.currentTime - 30.001) < 1e-9,
  '播放中的全屏退出也应触发不影响用户可见时间的极小跳转'
);
assert.equal(replayRefreshApp.chatRefreshPending, false, '完成同步后应清除等待状态');

const timelineSyncApp = new YouTubeDanmakuApp();
let timelineRebuilds = 0;
timelineSyncApp.video = { currentTime: 100, playbackRate: 2 };
timelineSyncApp.rebuildDanmakuTimeline = () => {
  timelineRebuilds += 1;
};
timelineSyncApp.recordMediaTimeObservation(1000);
timelineSyncApp.video.currentTime = 102;
assert.equal(
  timelineSyncApp.handleMediaTimeUpdate(2000),
  false,
  '二倍速下正常推进的媒体时间不应被误判为跳转'
);
timelineSyncApp.video.currentTime = 112;
assert.equal(
  timelineSyncApp.handleMediaTimeUpdate(2100),
  true,
  '漏发 seeked 时大幅快进仍应触发时间轴重建'
);
timelineSyncApp.video.currentTime = 80;
assert.equal(
  timelineSyncApp.handleMediaTimeUpdate(2200),
  true,
  '漏发 seeked 时快退仍应触发时间轴重建'
);
assert.equal(timelineRebuilds, 2, '每次检测到时间轴跳变都应重建一次弹幕');

const navigationApp = new YouTubeDanmakuApp();
navigationApp.player = player;
navigationApp.videoId = 'previous-video';
navigationApp.controls = { isConnected: true };
navigationApp.stage = { isConnected: true };
let unmountCount = 0;
let mountedVideoId = null;
navigationApp.unmountPlayer = () => {
  unmountCount += 1;
  navigationApp.player = null;
  navigationApp.videoId = '';
};
navigationApp.mountElements = (mountedPlayer, mountedControls, mountedVideo, videoId) => {
  assert.equal(mountedPlayer, player);
  assert.equal(mountedControls, rightControls);
  assert.equal(mountedVideo, video);
  mountedVideoId = videoId;
  return true;
};

location.pathname = '/live/next-video';
location.href = 'https://www.youtube.com/live/next-video';
assert.equal(navigationApp.mount(), true, '/live/<id> 切换后应重新挂载弹幕会话');
assert.equal(unmountCount, 1, '复用同一播放器时也应清理上一个视频的弹幕状态');
assert.equal(mountedVideoId, 'next-video', '新会话应绑定到当前视频 ID');

const messageApp = new YouTubeDanmakuApp();
messageApp.videoId = 'next-video';
messageApp.engine = {};
let handledMessage = null;
let scheduledMounts = 0;
messageApp.handleChatMessage = (message) => {
  handledMessage = message;
};
messageApp.scheduleMount = () => {
  scheduledMounts += 1;
};

messageApp.handleWindowMessage({
  origin: location.origin,
  source: chatSource,
  data: {
    source: 'youtube-danmaku-extension',
    type: 'chat-message',
    payload: {
      id: 'stale',
      videoId: 'previous-video',
      text: '旧视频评论',
      segments: [{ type: 'text', text: '旧视频评论' }]
    }
  }
});
assert.equal(handledMessage, null, '旧聊天 iframe 的迟到消息不应进入新视频');

messageApp.handleWindowMessage({
  origin: location.origin,
  source: chatSource,
  data: {
    source: 'youtube-danmaku-extension',
    type: 'chat-message',
    payload: {
      id: 'current',
      videoId: 'next-video',
      text: '当前视频评论',
      segments: [{ type: 'text', text: '当前视频评论' }]
    }
  }
});
assert.equal(handledMessage?.id, 'current', '当前视频的聊天消息应正常进入弹幕引擎');
const batchHandledMessages = [];
messageApp.handleChatMessage = (message) => {
  batchHandledMessages.push(message);
};
messageApp.handleWindowMessage({
  origin: location.origin,
  source: chatSource,
  data: {
    source: 'youtube-danmaku-extension',
    type: 'chat-message-batch',
    payloads: [
      {
        id: 'batch-1',
        videoId: 'next-video',
        text: '批次一',
        segments: [{ type: 'text', text: '批次一' }]
      },
      { id: 'invalid-batch-item', text: '缺少片段' },
      {
        id: 'batch-2',
        videoId: 'next-video',
        text: '批次二',
        segments: [{ type: 'text', text: '批次二' }]
      }
    ],
    diagnostics: {
      queuedRenderers: 3,
      processedRenderers: 2,
      queuedWork: 1,
      unexpectedField: 999
    }
  }
});
assert.deepEqual(
  batchHandledMessages.map((message) => message.id),
  ['batch-1', 'batch-2'],
  '批量消息应逐条校验，单条无效内容不应导致整个批次丢失'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(messageApp.bridgeDiagnostics)),
  { queuedRenderers: 3, processedRenderers: 2, queuedWork: 1 },
  '顶层页面只应保留受支持的桥接性能诊断字段'
);
messageApp.handleChatMessage = (message) => {
  handledMessage = message;
};
let readyRefreshes = 0;
messageApp.chatRefreshPending = true;
messageApp.refreshChatReplay = () => {
  readyRefreshes += 1;
  messageApp.chatRefreshPending = false;
};
messageApp.handleWindowMessage({
  origin: location.origin,
  source: chatSource,
  data: {
    source: 'youtube-danmaku-extension',
    type: 'chat-ready',
    videoId: 'next-video'
  }
});
assert.equal(readyRefreshes, 1, '新聊天 iframe 就绪后应立即执行等待中的回放同步');
assert.equal(
  context.document.querySelectorAll('iframe').length,
  0,
  '合法子窗口消息不应依赖顶层页面能否查询到聊天 iframe 节点'
);

handledMessage = null;
messageApp.handleWindowMessage({
  origin: location.origin,
  source: window,
  data: {
    source: 'youtube-danmaku-extension',
    type: 'chat-message',
    payload: {
      id: 'forged',
      videoId: 'next-video',
      text: '伪造评论',
      segments: [{ type: 'text', text: '伪造评论' }]
    }
  }
});
assert.equal(handledMessage, null, '播放器页自身伪造的同源消息不应被接收');
assert.equal(
  isValidChatMessagePayload({ id: 'missing-segments', text: '缺少结构化内容' }),
  false,
  '缺少结构化片段的消息不应进入弹幕引擎'
);
assert.equal(
  isValidChatMessagePayload({
    id: 'invalid-video-time',
    videoTime: 'not-a-time',
    segments: [{ type: 'text', text: '无效时间' }]
  }),
  false,
  '无效回放时间不应进入弹幕引擎'
);
assert.equal(
  isValidChatMessagePayload({
    id: 'bridge-payload',
    videoId: 'next-video',
    text: '带表情的合法评论',
    segments: [
      { type: 'text', text: '带表情的合法评论' },
      { type: 'emoji', src: 'https://yt3.ggpht.com/example', alt: ':emoji:' }
    ],
    role: 'viewer',
    authorName: 'viewer',
    authorColor: 'rgb(255, 255, 255)',
    authorBackground: 'rgba(0, 0, 0, 0)',
    color: '#ffffff'
  }),
  true,
  '聊天 iframe 实际转发的文本、表情和颜色字段应通过负载校验'
);

const replayTimingApp = new YouTubeDanmakuApp();
replayTimingApp.video = { currentTime: 100 };
const replayScheduled = [];
replayTimingApp.engine = {
  enqueueDeferred(message) {
    replayScheduled.push(message);
  }
};
replayTimingApp.handleChatMessage({
  id: 'hydrated-old-message',
  videoTime: 90,
  text: '重新加载时注入的旧评论',
  segments: [{ type: 'text', text: '重新加载时注入的旧评论' }]
});
assert.equal(replayTimingApp.timelineMessages.length, 1, '旧回放评论仍应保留供时间轴重建');
assert.equal(replayScheduled.length, 0, '明显过时的回放评论不应在重新加载时批量起跑');
replayTimingApp.handleChatMessage({
  id: 'current-replay-message',
  videoTime: 98,
  text: '当前评论',
  segments: [{ type: 'text', text: '当前评论' }]
});
assert.equal(replayScheduled.length, 1, '接近当前播放时间的评论应进入延后生成队列');

messageApp.videoId = 'previous-video';
handledMessage = null;
messageApp.handleWindowMessage({
  origin: location.origin,
  source: chatSource,
  data: {
    source: 'youtube-danmaku-extension',
    type: 'chat-message',
    payload: {
      id: 'during-navigation',
      videoId: 'next-video',
      text: '导航中评论',
      segments: [{ type: 'text', text: '导航中评论' }]
    }
  }
});
assert.equal(handledMessage, null, '播放器会话尚未切换时不应接收新视频消息');
assert.equal(scheduledMounts, 1, '检测到导航竞态时应尽快重新挂载当前视频会话');

const startupApp = new YouTubeDanmakuApp();
startupApp.scheduleMount = () => {};
let startupMessage = null;
startupApp.handleChatMessage = (message) => {
  startupMessage = message;
};
startupApp.handleWindowMessage({
  origin: location.origin,
  source: chatSource,
  data: {
    source: 'youtube-danmaku-extension',
    type: 'chat-message',
    payload: {
      id: 'during-startup',
      videoId: 'next-video',
      text: '启动阶段评论',
      segments: [{ type: 'text', text: '启动阶段评论' }]
    }
  }
});
assert.equal(startupApp.pendingMessages.length, 1, '引擎挂载前的合法消息应暂存');
startupApp.flushPendingMessages('next-video');
assert.equal(startupMessage?.id, 'during-startup', '引擎挂载后应补交启动阶段暂存的消息');

console.log('content session tests passed');
