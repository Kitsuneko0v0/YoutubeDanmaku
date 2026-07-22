'use strict';

const assert = require('node:assert/strict');
const {
  advanceDanmakuX,
  alignToDevicePixel,
  calculateBilibiliDanmakuX,
  calculateDanmakuX,
  DanmakuEngine,
  getBilibiliDanmakuDuration,
  getBilibiliDanmakuVelocity,
  getAvailableLane,
  getDuplicateKey,
  getFixedMergeLaneLimit,
  getOpacityChannels,
  getPreemptionLane,
  isSafeImageUrl,
  normalizeDanmakuMessage,
  normalizeMessageSegments,
  willDanmakuCollide,
  DEFAULT_ENGINE_OPTIONS
} = require('../src/danmaku-engine.js');

assert.equal(calculateDanmakuX(1200, 144, 10, 10), 1200, '弹幕应从其视频时间点的屏幕右侧开始');
assert.equal(calculateDanmakuX(1200, 144, 12, 10), 912, '播放两秒后弹幕位置应由视频时间计算');
assert.equal(calculateDanmakuX(1200, 144, 15, 10), 480, '快进后弹幕应立即移动到对应位置');
assert.equal(calculateDanmakuX(1200, 144, 11, 10), 1056, '快退后弹幕应立即回到对应位置');

assert.equal(
  advanceDanmakuX(1200, 144, 0.5),
  1128,
  '正常播放时弹幕应按真实帧间隔推进'
);
assert.equal(
  advanceDanmakuX(1128, 144, 0),
  1128,
  '动画帧未推进时不应产生额外位移'
);

assert.equal(alignToDevicePixel(100.24, 2), 100, 'DPR=2 时应对齐到半个 CSS 像素');
assert.equal(alignToDevicePixel(100.26, 2), 100.5, 'DPR=2 时应保留物理像素级位移');
assert.equal(alignToDevicePixel(100.6, 0), 101, '无效 DPR 应回退到整数 CSS 像素');

assert.equal(
  getBilibiliDanmakuDuration(682, 1),
  4,
  'Bilibili 基准宽度下应使用最短 4 秒存活时间'
);
assert.equal(
  Number(getBilibiliDanmakuDuration(1200, 1).toFixed(3)),
  6.686,
  'Bilibili 存活时间应随播放器宽度等比例增加'
);
assert.equal(
  getBilibiliDanmakuDuration(1920, 1),
  9,
  '高分辨率播放器的存活时间应限制在 9 秒'
);
assert.equal(
  getBilibiliDanmakuDuration(682, 2),
  2,
  '现有 2× 速度设置应将 Bilibili 存活时间减半'
);
assert.equal(
  getBilibiliDanmakuVelocity(1200, 240, 8),
  180,
  '像素速度应等于屏幕宽度与弹幕宽度之和除以存活时间'
);
assert.equal(
  calculateBilibiliDanmakuX(1200, 240, 8, 2, 0),
  840,
  'Bilibili 流速下的位置应由每条弹幕自身宽度计算'
);
assert.ok(
  getBilibiliDanmakuVelocity(1200, 600, 8)
    > getBilibiliDanmakuVelocity(1200, 120, 8),
  '相同存活时间下长弹幕应比短弹幕移动更快'
);

assert.deepEqual(
  getOpacityChannels(0.7),
  { fill: 0.7, outline: 0.7 },
  '描边透明度应与设置透明度保持一致'
);
assert.deepEqual(
  getOpacityChannels(0),
  { fill: 0, outline: 0 },
  '0% 透明度下文字和描边都应完全不可见'
);

let pauseSyncCount = 0;
const pauseHarness = {
  paused: false,
  lastFrameTime: 123,
  syncAnimationLoop() {
    pauseSyncCount += 1;
  }
};
DanmakuEngine.prototype.setPaused.call(pauseHarness, false);
assert.equal(pauseHarness.lastFrameTime, 123, '重复播放事件不应重置上一帧时间');
assert.equal(pauseSyncCount, 0, '重复播放事件不应重复同步动画循环');
DanmakuEngine.prototype.setPaused.call(pauseHarness, true);
assert.equal(pauseHarness.lastFrameTime, null, '实际暂停时应清空上一帧时间');
assert.equal(pauseSyncCount, 1, '实际暂停时应同步动画循环一次');
DanmakuEngine.prototype.setPaused.call(pauseHarness, true);
assert.equal(pauseSyncCount, 1, '重复暂停事件不应重复同步动画循环');

let scheduledRenderCount = 0;
const scheduledRenderHarness = {
  enabled: true,
  paused: false,
  frameId: 1,
  inAnimationFrame: false,
  renderFrame() {
    scheduledRenderCount += 1;
  }
};
DanmakuEngine.prototype.requestRender.call(scheduledRenderHarness);
assert.equal(
  scheduledRenderCount,
  0,
  '已有动画帧等待执行时，新评论不应额外整幅重绘主 Canvas'
);
scheduledRenderHarness.frameId = null;
DanmakuEngine.prototype.requestRender.call(scheduledRenderHarness);
assert.equal(scheduledRenderCount, 1, '没有动画帧兜底时仍应立即刷新主 Canvas');

const moving = (x, width, velocity, protectedMessage = false) => ({
  x,
  width,
  velocity,
  message: { protected: protectedMessage }
});
const lane = (
  rightEdge,
  load,
  protectedCount = 0,
  blockingNormal = null,
  items = [],
  fixedBusy = false
) => ({
  items,
  fixedBusy,
  rightEdge,
  load,
  protectedCount,
  blockingNormal
});

const leadingShort = moving(600, 120, 165);
const trailingLong = moving(900, 600, 225);
const trailingSlow = moving(900, 100, 150);
assert.equal(
  willDanmakuCollide(leadingShort, trailingLong, 40),
  true,
  '后方长弹幕会在前方短弹幕退出前追上时，应判定为碰撞'
);
assert.equal(
  willDanmakuCollide(leadingShort, trailingSlow, 40),
  false,
  '后方弹幕速度不高于前方弹幕时，已有安全间距应持续有效'
);
assert.equal(
  getAvailableLane(
    [lane(720, 1, 0, leadingShort, [leadingShort]), lane(null, 0)],
    trailingLong,
    40
  ),
  1,
  'Bilibili 轨道算法应跳过未来会追尾的第一行'
);
assert.equal(
  getAvailableLane(
    [lane(720, 1, 0, leadingShort, [leadingShort]), lane(null, 0)],
    trailingSlow,
    40
  ),
  0,
  'Bilibili 轨道算法应从上到下复用第一条全程安全的轨道'
);
assert.equal(
  getAvailableLane(
    [
      lane(720, 1, 0, leadingShort, [leadingShort]),
      lane(720, 1, 0, leadingShort, [leadingShort])
    ],
    trailingLong,
    40
  ),
  -1,
  '所有轨道都存在当前或未来碰撞时应拒绝普通弹幕'
);
assert.equal(
  getAvailableLane(
    [
      lane(null, 0, 0, null, [], true),
      lane(null, 0)
    ],
    trailingSlow,
    40
  ),
  1,
  '居中合并弹幕占用的轨道应阻止新的滚动弹幕进入'
);
assert.equal(getFixedMergeLaneLimit(2), 1, '低轨道数时只应开放一条居中合并轨道');
assert.equal(getFixedMergeLaneLimit(8), 2, '居中合并轨道最多占总轨道数的四分之一');
assert.equal(getFixedMergeLaneLimit(20), 3, '居中合并轨道数量应限制在三条以内');

const simulatedStageWidth = 1200;
const simulatedDuration = getBilibiliDanmakuDuration(simulatedStageWidth, 1);
const simulatedGap = 36;
const simulatedLanes = Array.from({ length: 12 }, () => []);
let simulatedSpawned = 0;
for (let index = 0; index < 300; index += 1) {
  const currentTime = index * 0.14;
  simulatedLanes.forEach((items) => {
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      item.x = calculateBilibiliDanmakuX(
        simulatedStageWidth,
        item.width,
        simulatedDuration,
        currentTime,
        item.startTime
      );
      if (item.x + item.width < 0) items.splice(itemIndex, 1);
    }
  });

  const width = 80 + (index * 137) % 620;
  const candidate = {
    startTime: currentTime,
    width,
    x: simulatedStageWidth,
    velocity: getBilibiliDanmakuVelocity(
      simulatedStageWidth,
      width,
      simulatedDuration
    )
  };
  const laneIndex = getAvailableLane(
    simulatedLanes.map((items) => ({ items })),
    candidate,
    simulatedGap
  );
  if (laneIndex === -1) continue;
  assert.equal(
    simulatedLanes[laneIndex].some((item) => (
      willDanmakuCollide(item, candidate, simulatedGap)
    )),
    false,
    '压力测试中被选轨道不应存在当前或未来碰撞'
  );
  simulatedLanes[laneIndex].push(candidate);
  simulatedSpawned += 1;
}
assert.ok(simulatedSpawned > 100, '高密度压力测试应成功安排足够数量的弹幕');

const normalA = { id: 'normal-a' };
const normalB = { id: 'normal-b' };
assert.equal(
  getPreemptionLane([lane(590, 4, 1, normalA), lane(580, 2, 0, normalB)]),
  1,
  '房管弹幕应优先抢占不含受保护弹幕的轨道'
);

assert.equal(
  getPreemptionLane([lane(590, 1, 0, null), lane(580, 2, 0, null)]),
  -1,
  '不存在普通阻塞弹幕时不应误报可抢占轨道'
);

assert.equal(isSafeImageUrl('https://yt3.ggpht.com/member-emoji.png'), true);
assert.equal(isSafeImageUrl('javascript:alert(1)'), false);
assert.equal(isSafeImageUrl('data:image/svg+xml,<svg/>'), false);
assert.equal(DEFAULT_ENGINE_OPTIONS.strokeWidth, 2, '默认描边粗细应为 2px');

assert.deepEqual(
  normalizeDanmakuMessage({ id: 'cached', text: '缓存重建', videoTime: 12 }, null),
  {
    id: 'cached',
    text: '缓存重建',
    videoTime: 12,
    segments: [{ type: 'text', text: '缓存重建' }],
    protected: false
  },
  '时间轴缓存中的原始消息应在重建前重新标准化'
);

assert.deepEqual(
  normalizeMessageSegments({
    segments: [
      { type: 'text', text: '欢迎 ' },
      { type: 'emoji', src: 'https://yt3.ggpht.com/member-emoji.png', alt: ':member:' },
      { type: 'emoji', src: 'javascript:alert(1)', alt: ':unsafe:' }
    ]
  }),
  [
    { type: 'text', text: '欢迎 ' },
    { type: 'emoji', src: 'https://yt3.ggpht.com/member-emoji.png', alt: ':member:' }
  ],
  '应保留 HTTPS 会员表情图片并过滤不安全的图片地址'
);

const duplicateMessage = normalizeDanmakuMessage({
  text: '重复弹幕',
  role: 'viewer'
}, 10);
assert.equal(
  getDuplicateKey(duplicateMessage),
  'text:重复弹幕',
  '普通弹幕应使用规范化后的精确内容生成重复键'
);
assert.equal(
  getDuplicateKey(normalizeDanmakuMessage({
    text: '重复弹幕',
    role: 'moderator'
  }, 10)),
  null,
  '房管和频道主弹幕不应参与普通重复合并'
);

function createFakeCanvasContext() {
  return {
    drawCalls: 0,
    fillFonts: [],
    fillRecords: [],
    arc() {},
    beginPath() {},
    clearRect() {},
    closePath() {},
    drawImage() {
      this.drawCalls += 1;
    },
    fill() {},
    fillRect() {},
    fillText() {
      this.fillFonts.push(this.font);
      this.fillRecords.push({
        fillStyle: this.fillStyle,
        font: this.font,
        strokeStyle: this.strokeStyle
      });
    },
    lineTo() {},
    measureText(text) {
      return { width: String(text).length * 12 };
    },
    moveTo() {},
    quadraticCurveTo() {},
    restore() {},
    save() {},
    scale() {},
    setTransform() {},
    stroke() {},
    strokeText() {}
  };
}

function createFakeCanvas() {
  const context = createFakeCanvasContext();
  return {
    context,
    contextOptions: null,
    contextType: null,
    height: 0,
    style: {},
    width: 0,
    getContext(type, options) {
      this.contextType = type;
      this.contextOptions = options;
      return context;
    },
    remove() {
      this.removed = true;
    },
    setAttribute() {}
  };
}

const originalDocument = global.document;
const originalDevicePixelRatio = global.devicePixelRatio;
const originalImage = global.Image;
const originalRequestAnimationFrame = global.requestAnimationFrame;
const originalCancelAnimationFrame = global.cancelAnimationFrame;
let nextAnimationFrameId = 1;
const animationFrameCallbacks = new Map();
global.requestAnimationFrame = (callback) => {
  const id = nextAnimationFrameId++;
  animationFrameCallbacks.set(id, callback);
  return id;
};
global.cancelAnimationFrame = (id) => {
  animationFrameCallbacks.delete(id);
};
const runNextAnimationFrame = () => {
  const next = animationFrameCallbacks.entries().next().value;
  assert.ok(next, '测试应存在等待执行的动画帧');
  animationFrameCallbacks.delete(next[0]);
  next[1](performance.now());
};
global.devicePixelRatio = 2;
let fakeCanvasCreationCount = 0;
global.document = {
  createElement(tagName) {
    assert.equal(tagName, 'canvas', 'Canvas 渲染模式不应为每条弹幕创建 DOM 文本元素');
    fakeCanvasCreationCount += 1;
    return createFakeCanvas();
  }
};

const stageStyle = {
  setProperty() {}
};
const fakeStage = {
  children: [],
  clientHeight: 320,
  clientWidth: 1200,
  dataset: {},
  hidden: false,
  isConnected: true,
  style: stageStyle,
  append(child) {
    this.children.push(child);
  }
};
let mediaTime = 100;
const canvasEngine = new DanmakuEngine(fakeStage, {
  fontSize: 24,
  fontFamily: '"MiSans", sans-serif',
  speed: 1,
  strokeWidth: 2
});
canvasEngine.setMediaClock(() => mediaTime);
canvasEngine.paused = false;
assert.equal(fakeStage.children.length, 1, '弹幕舞台应只挂载一个主 Canvas');
assert.equal(
  fakeStage.children[0].contextType,
  '2d',
  '弹幕舞台应使用 2D Canvas 上下文'
);
assert.deepEqual(
  fakeStage.children[0].contextOptions,
  { alpha: true },
  '弹幕舞台应保留透明通道，并避免使用可能绕过普通合成路径的低延迟上下文'
);
assert.equal(
  canvasEngine.enqueue({ text: '短弹幕', videoTime: mediaTime }),
  true,
  '第一条弹幕应成功进入 Canvas 渲染队列'
);
mediaTime += 0.2;
assert.equal(
  canvasEngine.enqueue({ text: '这是一条明显更长并且速度更快的测试弹幕', videoTime: mediaTime }),
  true,
  '第二条弹幕应成功进入 Canvas 渲染队列'
);
assert.equal(canvasEngine.active[0].lane, 0, '第一条弹幕应使用第一行');
assert.equal(canvasEngine.active[1].lane, 1, '入口发生碰撞时第二条弹幕应使用下一行');
assert.ok(
  canvasEngine.active[1].velocity > canvasEngine.active[0].velocity,
  'Canvas 引擎中的长弹幕应获得更高的实际像素速度'
);
assert.ok(
  canvasEngine.context.drawCalls > 0,
  '主 Canvas 应绘制预渲染的弹幕缓存'
);
assert.equal(
  Object.hasOwn(canvasEngine.active[0], 'element'),
  false,
  '活动弹幕不应再持有独立 DOM 元素'
);
const releasedItem = canvasEngine.active[0];
const releasedItemKey = getDuplicateKey(releasedItem.message);
assert.equal(canvasEngine.repeatGroups.has(releasedItemKey), true, '活动普通弹幕应登记重复分组');
canvasEngine.removeItem(releasedItem);
assert.equal(
  canvasEngine.repeatGroups.has(releasedItemKey),
  false,
  '普通弹幕离场后应释放重复分组及其离屏 Canvas 引用'
);
canvasEngine.clearActive();
const originalGetLaneState = canvasEngine.getLaneState;
canvasEngine.getLaneState = () => [{ fixedBusy: true, items: [] }];
const canvasCountBeforeRejectedMessage = fakeCanvasCreationCount;
for (let index = 0; index < 100; index += 1) {
  assert.equal(
    canvasEngine.trySpawn(normalizeDanmakuMessage({ text: `满轨时应直接丢弃 ${index}` }, mediaTime)),
    false,
    '没有可用轨道时普通弹幕应被丢弃'
  );
}
assert.equal(
  fakeCanvasCreationCount,
  canvasCountBeforeRejectedMessage,
  '满轨丢弃一百条弹幕时只应测量，不应创建渲染 Canvas'
);
canvasEngine.getLaneState = originalGetLaneState;

for (let index = 0; index < 10; index += 1) {
  canvasEngine.enqueueDeferred({ id: `deferred-${index}`, text: `突发评论 ${index}`, videoTime: mediaTime });
}
assert.equal(canvasEngine.active.length, 0, '突发评论入列时不应在消息事件中同步创建渲染面');
assert.equal(canvasEngine.incomingNormalQueue.length, 10, '突发评论应等待动画帧预算处理');
canvasEngine.drainIncomingMessages();
assert.ok(canvasEngine.active.length <= 4, '单帧最多只应处理四条新评论');
assert.ok(canvasEngine.incomingNormalQueue.length >= 6, '其余突发评论应保留到后续动画帧');
if (canvasEngine.frameId != null) cancelAnimationFrame(canvasEngine.frameId);
canvasEngine.frameId = null;
canvasEngine.clearActive();

canvasEngine.clearActive();
mediaTime = 200;
assert.equal(
  canvasEngine.enqueue({ id: 'repeat-1', text: '大家一起鼓掌', videoTime: mediaTime }),
  true,
  '第一条重复内容应作为普通滚动弹幕显示'
);
const repeatOrigin = canvasEngine.active[0];
assert.equal(canvasEngine.fixedActive.length, 0, '第一条弹幕不应提前创建居中计数版');
assert.ok(
  repeatOrigin.surface.canvas.context.fillFonts
    .some((font) => String(font).startsWith('500 ')),
  '未开启用户粗体设置时，第一条滚动弹幕应保持普通字重'
);

mediaTime += 0.3;
assert.equal(
  canvasEngine.enqueue({ id: 'repeat-2', text: '大家一起鼓掌', videoTime: mediaTime }),
  true,
  '第二条相同内容仍应作为普通滚动弹幕显示'
);
assert.equal(canvasEngine.active.length, 2, '第二条相同内容应保留独立滚动实例');
assert.equal(
  canvasEngine.active[0],
  repeatOrigin,
  '第二条滚动弹幕出现时必须保留第一条滚动弹幕'
);
const secondRepeatOrigin = canvasEngine.active[1];
assert.equal(canvasEngine.fixedActive.length, 0, '第二条相同内容不应提前进入特殊播放模式');

mediaTime += 8;
assert.equal(
  canvasEngine.enqueue({ id: 'repeat-3', text: '大家一起鼓掌', videoTime: mediaTime }),
  true,
  '视频时间因倍速大幅推进时，仍在画面上的第三条相同内容应创建居中计数版'
);
assert.equal(canvasEngine.active.length, 2, '第三条相同内容不应再创建滚动实例');
assert.equal(canvasEngine.active[0], repeatOrigin, '第一条滚动弹幕应继续完成播放');
assert.equal(canvasEngine.active[1], secondRepeatOrigin, '第二条滚动弹幕也应继续完成播放');
assert.equal(canvasEngine.fixedActive.length, 1, '第三条相同内容应创建一条居中弹幕');
assert.equal(
  canvasEngine.fixedActive[0].duration,
  getBilibiliDanmakuDuration(fakeStage.clientWidth, canvasEngine.options.speed),
  '居中重复弹幕的保留时间应与滚动弹幕的实际存活时间一致'
);
assert.equal(
  canvasEngine.fixedActive[0].counterSurface.label,
  '+2',
  '特殊播放模式应从总计第三条弹幕开始显示 +2'
);
assert.ok(
  canvasEngine.fixedActive[0].bodySurface.canvas.context.fillFonts
    .some((font) => String(font).startsWith('700 ')),
  '居中的重复弹幕正文应强制使用粗体'
);
assert.ok(
  canvasEngine.fixedActive[0].bodySurface.fontSize > 24,
  '单轨空间足够时，居中的重复弹幕正文应适当放大字号'
);
assert.ok(
  canvasEngine.fixedActive[0].bodySurface.strokeWidth > 2,
  '居中的重复弹幕正文应使用比普通弹幕更粗的描边'
);
assert.ok(
  canvasEngine.fixedActive[0].bodySurface.verticalGap >= 2.4,
  '放大后的重复弹幕仍应在轨道内保留足够的垂直间距'
);
assert.ok(
  canvasEngine.fixedActive[0].counterSurface.canvas.context.fillRecords
    .some((record) => (
      record.fillStyle === '#ffffff'
      && record.strokeStyle === '#18e56f'
      && String(record.font).includes('"MiSans", sans-serif')
      && !String(record.font).includes('Impact')
    )),
  '重复计数应使用用户字体、白色字色和绿色描边'
);
assert.equal(
  canvasEngine.getLaneState()[canvasEngine.fixedActive[0].lane].fixedBusy,
  true,
  '居中弹幕播放期间对应轨道应始终标记为忙碌'
);

mediaTime += 8;
assert.equal(
  canvasEngine.enqueue({ id: 'repeat-4', text: '大家一起鼓掌', videoTime: mediaTime }),
  true,
  '视频时间因倍速再次大幅推进时，后续重复内容仍应更新已有中置计数版'
);
assert.equal(canvasEngine.active.length, 2, '后续重复内容不应增加滚动弹幕数量');
assert.equal(canvasEngine.fixedActive.length, 1, '后续重复内容不应增加居中弹幕数量');
assert.equal(
  canvasEngine.fixedActive[0].counterSurface.label,
  '+3',
  '第四条相同内容应将额外重复计数更新为 +3'
);

canvasEngine.applyOptions({ fontSize: 12, strokeWidth: 4, bold: false });
const compactRepeatSurface = canvasEngine.createRenderSurface(
  normalizeDanmakuMessage({ text: '紧凑轨道重复弹幕', role: 'viewer' }, mediaTime),
  {
    enhanceStroke: true,
    forceBold: true,
    fontScale: 1.12,
    preserveLaneGap: true
  }
);
assert.ok(
  compactRepeatSurface.fontSize >= 12
    && compactRepeatSurface.fontSize <= 12 * 1.12,
  '小字号和粗描边组合下，重复弹幕字号应在单轨安全范围内动态限制'
);
assert.ok(
  compactRepeatSurface.inkHeight <= compactRepeatSurface.height - 2 + 0.01,
  '紧凑设置下重复弹幕也不应侵入相邻轨道'
);

canvasEngine.clearActive();
mediaTime = 300;
let pendingEmojiImage = null;
global.Image = class FakeImage {
  constructor() {
    pendingEmojiImage = this;
  }

  set src(value) {
    this.currentSrc = value;
  }
};
const repeatedEmojiMessage = {
  segments: [
    { type: 'emoji', src: 'https://yt3.ggpht.com/repeated-emoji.png', alt: ':repeat:' },
    { type: 'emoji', src: 'https://yt3.ggpht.com/repeated-emoji.png', alt: ':repeat:' },
    { type: 'emoji', src: 'https://yt3.ggpht.com/repeated-emoji.png', alt: ':repeat:' }
  ],
  text: ':repeat::repeat::repeat:'
};
assert.equal(canvasEngine.enqueue({ ...repeatedEmojiMessage, id: 'emoji-repeat-1' }), true);
mediaTime += 0.2;
assert.equal(canvasEngine.enqueue({ ...repeatedEmojiMessage, id: 'emoji-repeat-2' }), true);
mediaTime += 0.2;
assert.equal(canvasEngine.enqueue({ ...repeatedEmojiMessage, id: 'emoji-repeat-3' }), true);
assert.equal(canvasEngine.fixedActive.length, 1, '重复表情应创建中置合并弹幕');
assert.equal(
  canvasEngine.emojiItemIndex.get('https://yt3.ggpht.com/repeated-emoji.png')?.size,
  3,
  '表情反向索引应记录两条滚动弹幕和一条中置弹幕'
);
const pendingEmojiSurface = canvasEngine.fixedActive[0].bodySurface;
assert.ok(pendingEmojiImage?.onload, '表情图片应注册异步加载完成回调');
pendingEmojiImage.onload();
assert.equal(
  canvasEngine.fixedActive[0].bodySurface,
  pendingEmojiSurface,
  '表情加载回调不应同步重建渲染面'
);
runNextAnimationFrame();
assert.notEqual(
  canvasEngine.fixedActive[0].bodySurface,
  pendingEmojiSurface,
  '表情加载完成后应重建中置弹幕的正文缓存'
);
assert.ok(
  canvasEngine.fixedActive[0].bodySurface.canvas.context.drawCalls >= 3,
  '重建后的中置弹幕正文应绘制所有已加载表情'
);

canvasEngine.clearActive();
assert.equal(canvasEngine.emojiItemIndex.size, 0, '清空活动弹幕后应释放表情反向索引');
mediaTime = 400;
canvasEngine.priorityQueue.push(
  { id: 'expired-priority', protected: true, videoTime: mediaTime - 100 },
  { id: 'current-priority', protected: true, videoTime: mediaTime }
);
canvasEngine.normalQueue.push(
  { id: 'expired-normal', protected: false, videoTime: mediaTime - 100 },
  { id: 'current-normal', protected: false, videoTime: mediaTime }
);
const originalTrySpawn = canvasEngine.trySpawn;
const drainedMessages = [];
canvasEngine.trySpawn = (message) => {
  drainedMessages.push(message.id);
  return true;
};
canvasEngine.drainQueues();
assert.deepEqual(
  drainedMessages,
  ['current-priority', 'current-normal'],
  '已永远离开可见时间窗的队首消息应被丢弃，且不阻塞后续队列'
);

canvasEngine.priorityQueue.push({
  id: 'temporarily-blocked-priority',
  protected: true,
  videoTime: mediaTime
});
canvasEngine.trySpawn = () => false;
canvasEngine.drainQueues();
assert.equal(
  canvasEngine.priorityQueue[0]?.id,
  'temporarily-blocked-priority',
  '仍在可见时间窗内的受保护消息应在轨道满载时继续等待'
);
canvasEngine.trySpawn = originalTrySpawn;

canvasEngine.destroy();
global.document = originalDocument;
global.devicePixelRatio = originalDevicePixelRatio;
global.Image = originalImage;
global.requestAnimationFrame = originalRequestAnimationFrame;
global.cancelAnimationFrame = originalCancelAnimationFrame;

console.log('danmaku-engine tests passed');
