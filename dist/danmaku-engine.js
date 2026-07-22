(function bootstrapDanmakuCore(root, factory) {
  const api = factory();
  root.YTDanmakuCore = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDanmakuCore() {
  'use strict';

  const DEFAULT_ENGINE_OPTIONS = Object.freeze({
    area: 50,
    opacity: 0.7,
    fontSize: 24,
    speed: 1,
    fontFamily: 'sans-serif',
    bold: false,
    strokeWidth: 2
  });
  const BILIBILI_PLAYER_WIDTH = 682;
  const BILIBILI_COMMON_DURATION = 3.8;
  const BILIBILI_MIN_DURATION = 4;
  const BILIBILI_MAX_DURATION = 9;
  const FIXED_MERGE_LANE_LIMITS = Object.freeze({
    25: 2,
    50: 3,
    75: 4,
    100: 5
  });
  const FIXED_MERGE_MAX_LANES = 5;
  const REPEAT_COUNTER_PULSE_SECONDS = 0.32;
  const MAX_MESSAGES_PER_FRAME = 4;
  const MAX_MESSAGES_PER_ANIMATION_FRAME = 1;
  const MAX_EMOJI_REBUILDS_PER_FRAME = 4;
  const MAX_PENDING_NORMAL_MESSAGES = 300;
  const MESSAGE_DRAIN_BUDGET_MS = 3;
  const DIAGNOSTICS_PUBLISH_INTERVAL_MS = 500;

  function createDiagnostics() {
    return {
      enqueueAttempts: 0,
      accepted: 0,
      rejected: 0,
      spawned: 0,
      merged: 0,
      deferred: 0,
      expired: 0,
      overflowed: 0,
      frames: 0,
      frameIntervals: 0,
      totalFrameGapMs: 0,
      maxFrameGapMs: 0,
      frameGapsOver25Ms: 0,
      frameGapsOver50Ms: 0,
      frameGapsOver100Ms: 0,
      totalFrameWorkMs: 0,
      maxFrameWorkMs: 0,
      frameWorkOver4Ms: 0,
      frameWorkOver8Ms: 0,
      frameWorkOver16Ms: 0,
      pauseTransitions: 0,
      resumeTransitions: 0,
      resumeFirstFrames: 0,
      maxResumeFirstFrameDeltaMs: 0
    };
  }

  function isSafeImageUrl(value) {
    if (!value || typeof value !== 'string') return false;
    try {
      return new URL(value, 'https://www.youtube.com/').protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function normalizeMessageSegments(message) {
    const segments = [];
    const source = Array.isArray(message?.segments) ? message.segments : [];

    source.forEach((segment) => {
      if (segment?.type === 'text' && typeof segment.text === 'string' && segment.text) {
        segments.push({ type: 'text', text: segment.text });
      } else if (segment?.type === 'emoji' && isSafeImageUrl(segment.src)) {
        segments.push({
          type: 'emoji',
          src: new URL(segment.src, 'https://www.youtube.com/').href,
          alt: typeof segment.alt === 'string' ? segment.alt : ''
        });
      }
    });

    if (!segments.length && typeof message?.text === 'string' && message.text) {
      segments.push({ type: 'text', text: message.text });
    }
    return segments;
  }

  function normalizeDanmakuMessage(message, fallbackTime) {
    if (!message) return null;
    const segments = normalizeMessageSegments(message);
    const plainText = segments
      .map((segment) => segment.type === 'text' ? segment.text : segment.alt)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!segments.length || (!plainText && !segments.some((segment) => segment.type === 'emoji'))) return null;

    const parsedVideoTime = Number(message.videoTime);
    const hasVideoTime = message.videoTime != null
      && message.videoTime !== ''
      && Number.isFinite(parsedVideoTime);

    return {
      ...message,
      text: plainText,
      segments,
      protected: message.role === 'moderator' || message.role === 'owner',
      videoTime: hasVideoTime
        ? parsedVideoTime
        : fallbackTime
    };
  }

  function getBilibiliDanmakuDuration(stageWidth, speed) {
    const width = Number(stageWidth);
    const speedFactor = Number(speed);
    const normalizedWidth = Number.isFinite(width) && width > 0 ? width : BILIBILI_PLAYER_WIDTH;
    const normalizedSpeed = Number.isFinite(speedFactor) && speedFactor > 0 ? speedFactor : 1;
    const viewportDuration = BILIBILI_COMMON_DURATION * normalizedWidth / BILIBILI_PLAYER_WIDTH;
    const baseDuration = Math.min(
      BILIBILI_MAX_DURATION,
      Math.max(BILIBILI_MIN_DURATION, viewportDuration)
    );
    return baseDuration / normalizedSpeed;
  }

  function getBilibiliDanmakuVelocity(stageWidth, danmakuWidth, duration) {
    const width = Number(stageWidth);
    const itemWidth = Number(danmakuWidth);
    const lifetime = Number(duration);
    if (![width, itemWidth, lifetime].every(Number.isFinite) || lifetime <= 0) return 0;
    return (Math.max(0, width) + Math.max(0, itemWidth)) / lifetime;
  }

  function normalizePlaybackRate(value) {
    const rate = Number(value);
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  }

  function calculateBilibiliDanmakuX(
    stageWidth,
    danmakuWidth,
    duration,
    currentTime,
    startTime,
    playbackRate = 1
  ) {
    const velocity = getBilibiliDanmakuVelocity(stageWidth, danmakuWidth, duration);
    const mediaDelta = currentTime - startTime;
    const presentationTime = startTime + mediaDelta / normalizePlaybackRate(playbackRate);
    return calculateDanmakuX(stageWidth, velocity, presentationTime, startTime);
  }

  function willDanmakuCollide(first, second, gap) {
    if (!first || !second) return false;
    const spacing = Number.isFinite(Number(gap)) ? Math.max(0, Number(gap)) : 0;
    const left = first.x <= second.x ? first : second;
    const right = left === first ? second : first;
    const leftRightEdge = left.x + left.width;

    if (leftRightEdge + spacing > right.x) return true;
    if (right.velocity <= left.velocity || leftRightEdge <= 0) return false;
    if (!(left.velocity > 0) || !(right.velocity > 0)) return true;

    const leadingRemainingTime = leftRightEdge / left.velocity;
    const trailingLeftAtLeadingExit = right.x - right.velocity * leadingRemainingTime;
    return trailingLeftAtLeadingExit < spacing;
  }

  function getAvailableLane(lanes, candidate, gap) {
    return lanes.findIndex((lane) => (
      !lane.fixedBusy
      && !lane.items?.some((item) => willDanmakuCollide(item, candidate, gap))
    ));
  }

  function getDuplicateKey(message) {
    if (!message || message.protected || !Array.isArray(message.segments)) return null;
    const parts = message.segments.map((segment) => {
      if (segment.type === 'emoji') return `emoji:${segment.src}|${segment.alt || ''}`;
      return `text:${segment.text}`;
    });
    return parts.length ? parts.join('\u001f') : null;
  }

  function getFixedMergeLaneLimit(area, laneCount) {
    const parsedArea = Number(area);
    const normalizedArea = Math.min(
      100,
      Math.max(25, Number.isFinite(parsedArea) ? parsedArea : DEFAULT_ENGINE_OPTIONS.area)
    );
    const areaStep = Math.min(100, Math.max(25, Math.round(normalizedArea / 25) * 25));
    const configuredLimit = FIXED_MERGE_LANE_LIMITS[areaStep];
    const count = Math.max(1, Math.floor(Number(laneCount) || 1));
    return Math.min(configuredLimit, count);
  }

  function getTemporaryLaneExpansion(area, baseLaneCount, fullLaneCount, fixedCount) {
    const normalizedArea = Math.min(100, Math.max(0, Number(area) || 0));
    if (normalizedArea >= 100) return 0;
    const baseCount = Math.max(1, Math.floor(Number(baseLaneCount) || 1));
    const fullCount = Math.max(baseCount, Math.floor(Number(fullLaneCount) || baseCount));
    const requestedCount = Math.min(
      FIXED_MERGE_MAX_LANES,
      Math.max(0, Math.floor(Number(fixedCount) || 0))
    );
    return Math.min(requestedCount, fullCount - baseCount);
  }

  function calculateDanmakuX(stageWidth, velocity, currentTime, startTime) {
    if (![stageWidth, velocity, currentTime, startTime].every(Number.isFinite)) return stageWidth;
    return stageWidth - velocity * (currentTime - startTime);
  }

  function advanceDanmakuX(currentX, velocity, deltaSeconds) {
    if (![currentX, velocity, deltaSeconds].every(Number.isFinite)) return currentX;
    return currentX - velocity * Math.max(0, deltaSeconds);
  }

  function alignToDevicePixel(value, pixelRatio) {
    if (!Number.isFinite(value)) return value;
    const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
    return Math.round(value * ratio) / ratio;
  }

  function getOpacityChannels(value) {
    const parsed = Number(value);
    const fill = Number.isFinite(parsed)
      ? Math.min(1, Math.max(0, parsed))
      : DEFAULT_ENGINE_OPTIONS.opacity;
    return {
      fill,
      outline: fill
    };
  }

  function getPreemptionLane(lanes) {
    let bestLane = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    lanes.forEach((lane, index) => {
      if (!lane.blockingNormal) return;
      const score = lane.protectedCount * 1000 + lane.load;
      if (score < bestScore) {
        bestLane = index;
        bestScore = score;
      }
    });

    return bestLane;
  }

  function normalizeColor(value, fallback) {
    if (!value || typeof value !== 'string') return fallback;
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return value;
    return CSS.supports('color', value.trim()) ? value.trim() : fallback;
  }

  class DanmakuEngine {
    constructor(stage, options) {
      if (!stage) throw new Error('DanmakuEngine requires a stage element.');

      this.stage = stage;
      this.options = { ...DEFAULT_ENGINE_OPTIONS, ...(options || {}) };
      this.active = [];
      this.fixedActive = [];
      this.repeatGroups = new Map();
      this.normalQueue = [];
      this.priorityQueue = [];
      this.incomingNormalQueue = [];
      this.incomingPriorityQueue = [];
      this.enabled = true;
      this.paused = true;
      this.frameId = null;
      this.inAnimationFrame = false;
      this.lastFrameTime = null;
      this.lastForcedPriorityTime = 0;
      this.nextId = 1;
      this.mediaClock = null;
      this.playbackRate = 1;
      this.diagnostics = createDiagnostics();
      this.lastDiagnosticsPublishTime = 0;
      this.awaitingResumeFirstFrame = false;
      this.timeline = [];
      this.timelineCursor = 0;
      this.imageCache = new Map();
      this.emojiItemIndex = new Map();
      this.pendingEmojiRebuilds = new Set();
      this.emojiRebuildFrameId = null;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'yd-danmaku-canvas';
      this.canvas.setAttribute('aria-hidden', 'true');
      this.context = this.canvas.getContext('2d', { alpha: true });
      this.stage.append(this.canvas);
      this.measureCanvas = document.createElement('canvas');
      this.measureContext = this.measureCanvas.getContext('2d');
      this.tick = this.tick.bind(this);
      this.flushEmojiSurfaceRebuilds = this.flushEmojiSurfaceRebuilds.bind(this);
      this.resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => this.reflow())
        : null;

      this.resizeObserver?.observe(this.stage);
      this.applyOptions(this.options);
    }

    applyOptions(nextOptions) {
      this.options = { ...this.options, ...nextOptions };
      const opacity = getOpacityChannels(this.options.opacity);
      this.updateStageHeight();
      this.stage.style.opacity = '1';
      this.stage.style.setProperty('--yd-element-opacity', String(opacity.fill));
      this.stage.style.setProperty('--yd-fill-opacity', `${opacity.fill * 100}%`);
      this.stage.style.setProperty('--yd-outline-opacity', `${opacity.outline * 100}%`);
      this.stage.style.setProperty('--yd-font-size', `${this.options.fontSize}px`);
      this.stage.style.setProperty('--yd-font-family', this.options.fontFamily || 'sans-serif');
      this.stage.style.setProperty('--yd-stroke-width', `${this.options.strokeWidth}px`);
      this.stage.dataset.bold = String(Boolean(this.options.bold));
      this.reflow(true);
    }

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      this.stage.hidden = !this.enabled;
      this.syncAnimationLoop();
    }

    setPaused(paused) {
      const nextPaused = Boolean(paused);
      if (this.paused === nextPaused) return;
      this.paused = nextPaused;
      if (nextPaused) {
        this.diagnostics.pauseTransitions += 1;
        this.awaitingResumeFirstFrame = false;
      } else {
        this.diagnostics.resumeTransitions += 1;
        this.awaitingResumeFirstFrame = true;
      }
      this.lastFrameTime = null;
      this.syncAnimationLoop();
      this.publishDiagnostics(true);
    }

    setMediaClock(mediaClock) {
      this.mediaClock = typeof mediaClock === 'function' ? mediaClock : null;
      this.lastFrameTime = null;
      this.syncToMediaTime();
    }

    setPlaybackRate(playbackRate) {
      this.playbackRate = normalizePlaybackRate(playbackRate);
    }

    getMediaTime() {
      if (!this.mediaClock) return null;
      const time = Number(this.mediaClock());
      return Number.isFinite(time) ? time : null;
    }

    queueNormalMessage(queue, message) {
      this.pruneExpiredQueueHead(queue);
      queue.push(message);
      if (queue.length > MAX_PENDING_NORMAL_MESSAGES) {
        const overflowed = queue.length - MAX_PENDING_NORMAL_MESSAGES;
        queue.splice(0, overflowed);
        this.diagnostics.overflowed += overflowed;
      }
    }

    markDeferred(message) {
      if (!message || message.__ydDeferred) return;
      message.__ydDeferred = true;
      message.__ydSpawnAtEntry = true;
      this.diagnostics.deferred += 1;
    }

    publishDiagnostics(force = false, now = performance.now()) {
      const currentTime = Number(now);
      if (
        !force
        && Number.isFinite(currentTime)
        && currentTime - this.lastDiagnosticsPublishTime < DIAGNOSTICS_PUBLISH_INTERVAL_MS
      ) return;
      if (Number.isFinite(currentTime)) this.lastDiagnosticsPublishTime = currentTime;

      const frameSeconds = this.diagnostics.totalFrameGapMs / 1000;
      this.stage.dataset.diagnostics = JSON.stringify({
        ...this.diagnostics,
        averageFps: frameSeconds > 0
          ? this.diagnostics.frameIntervals / frameSeconds
          : 0,
        averageFrameWorkMs: this.diagnostics.frames > 0
          ? this.diagnostics.totalFrameWorkMs / this.diagnostics.frames
          : 0,
        active: this.active.length,
        fixedActive: this.fixedActive.length,
        queuedNormal: this.normalQueue.length + this.incomingNormalQueue.length,
        queuedPriority: this.priorityQueue.length + this.incomingPriorityQueue.length
      });
    }

    enqueue(message) {
      this.diagnostics.enqueueAttempts += 1;
      if (!message) {
        this.diagnostics.rejected += 1;
        return false;
      }
      const normalized = normalizeDanmakuMessage(message, this.getMediaTime());
      if (!normalized) {
        this.diagnostics.rejected += 1;
        return false;
      }
      this.diagnostics.accepted += 1;

      if (!this.enabled || this.paused) {
        if (normalized.protected) {
          this.priorityQueue.push(normalized);
        } else {
          this.markDeferred(normalized);
          this.queueNormalMessage(this.normalQueue, normalized);
        }
        return true;
      }

      const spawned = this.trySpawn(normalized);
      if (!spawned) {
        if (normalized.protected) this.priorityQueue.push(normalized);
        else {
          this.markDeferred(normalized);
          this.queueNormalMessage(this.normalQueue, normalized);
        }
      }
      return true;
    }

    enqueueDeferred(message) {
      this.diagnostics.enqueueAttempts += 1;
      if (!message) {
        this.diagnostics.rejected += 1;
        return false;
      }
      const normalized = normalizeDanmakuMessage(message, this.getMediaTime());
      if (!normalized) {
        this.diagnostics.rejected += 1;
        return false;
      }
      this.diagnostics.accepted += 1;
      this.markDeferred(normalized);

      if (!this.enabled || this.paused) {
        if (normalized.protected) {
          this.priorityQueue.push(normalized);
        } else {
          this.queueNormalMessage(this.normalQueue, normalized);
        }
        return true;
      }

      if (normalized.protected) {
        this.incomingPriorityQueue.push(normalized);
      } else {
        this.queueNormalMessage(this.incomingNormalQueue, normalized);
      }
      if (!this.inAnimationFrame) this.syncAnimationLoop();
      return true;
    }

    getLineHeight() {
      return Math.max(20, Math.ceil(this.options.fontSize * 1.35));
    }

    getBaseLaneCount() {
      const lineHeight = this.getLineHeight();
      const parentHeight = Number(this.stage.parentElement?.clientHeight);
      const stageHeight = Number(this.stage.clientHeight);
      const baseHeight = Number.isFinite(parentHeight) && parentHeight > 0
        ? parentHeight * Math.min(100, Math.max(0, Number(this.options.area) || 0)) / 100
        : stageHeight;
      return Math.max(1, Math.floor(baseHeight / lineHeight));
    }

    getTemporaryLaneCount() {
      const baseLaneCount = this.getBaseLaneCount();
      return getTemporaryLaneExpansion(
        this.options.area,
        baseLaneCount,
        this.getFullLaneCount(),
        this.fixedActive.length
      );
    }

    getRetainedTemporaryLaneCount() {
      const baseLaneCount = this.getBaseLaneCount();
      const allocatedLaneCount = this.getTemporaryLaneCount();
      const highestOccupiedLane = this.active.reduce(
        (highest, item) => Math.max(highest, Number(item.lane) || 0),
        baseLaneCount - 1
      );
      const occupiedExtraLaneCount = Math.max(
        0,
        highestOccupiedLane - baseLaneCount + 1
      );
      return Math.min(
        this.getFullLaneCount() - baseLaneCount,
        Math.max(allocatedLaneCount, occupiedExtraLaneCount)
      );
    }

    getFullLaneCount() {
      const parentHeight = Number(this.stage.parentElement?.clientHeight);
      return Number.isFinite(parentHeight) && parentHeight > 0
        ? Math.max(1, Math.floor(parentHeight / this.getLineHeight()))
        : this.getBaseLaneCount() + FIXED_MERGE_MAX_LANES;
    }

    getFixedLaneLimit() {
      return getFixedMergeLaneLimit(this.options.area, this.getBaseLaneCount());
    }

    updateStageHeight() {
      const extraHeight = this.getRetainedTemporaryLaneCount() * this.getLineHeight();
      this.stage.style.height = extraHeight > 0
        ? `min(100%, calc(${this.options.area}% + ${extraHeight}px))`
        : `${this.options.area}%`;
    }

    getLaneCount() {
      return this.getBaseLaneCount() + this.getTemporaryLaneCount();
    }

    getRenderLaneCount() {
      return this.getBaseLaneCount() + this.getRetainedTemporaryLaneCount();
    }

    getLaneState() {
      const count = this.getLaneCount();
      const lanes = Array.from({ length: count }, () => ({
        items: [],
        fixedBusy: false,
        rightEdge: null,
        load: 0,
        protectedCount: 0,
        blockingNormal: null
      }));

      this.active.forEach((item) => {
        const laneIndex = Number(item.lane);
        if (!Number.isInteger(laneIndex) || laneIndex < 0 || laneIndex >= count) return;
        const lane = lanes[laneIndex];
        const rightEdge = item.x + item.width;
        lane.items.push(item);
        lane.load += 1;
        if (item.message.protected) lane.protectedCount += 1;
        if (lane.rightEdge == null || rightEdge > lane.rightEdge) {
          lane.rightEdge = rightEdge;
        }
        if (!item.message.protected && (
          !lane.blockingNormal
          || rightEdge > lane.blockingNormal.x + lane.blockingNormal.width
        )) {
          lane.blockingNormal = item;
        }
      });

      this.fixedActive.forEach((item) => {
        const laneIndex = Math.min(item.lane, count - 1);
        lanes[laneIndex].fixedBusy = true;
      });

      return lanes;
    }

    trySpawn(message) {
      const stageWidth = this.stage.clientWidth;
      if (!stageWidth || !this.stage.clientHeight) return false;

      const duplicateKey = getDuplicateKey(message);
      if (duplicateKey && this.tryMergeDuplicate(message, duplicateKey)) return true;

      const layout = this.createRenderLayout(message);
      const duration = getBilibiliDanmakuDuration(stageWidth, this.options.speed);
      const velocity = getBilibiliDanmakuVelocity(stageWidth, layout.width, duration);
      const currentMediaTime = this.getMediaTime();
      const startTime = message.__ydSpawnAtEntry && currentMediaTime != null
        ? currentMediaTime
        : Number.isFinite(Number(message.videoTime))
        ? Number(message.videoTime)
        : currentMediaTime;
      const spawnX = currentMediaTime == null || startTime == null
        ? stageWidth
        : calculateBilibiliDanmakuX(
          stageWidth,
          layout.width,
          duration,
          currentMediaTime,
          startTime,
          this.playbackRate
        );

      if (spawnX > stageWidth + 1) return false;
      if (spawnX + layout.width < 0) return false;

      const candidate = {
        message,
        startTime,
        x: spawnX,
        width: layout.width,
        height: layout.height,
        duration,
        velocity
      };
      const gap = Math.max(28, this.options.fontSize * 1.5);

      let lanes = this.getLaneState();
      let lane = getAvailableLane(lanes, candidate, gap);

      if (lane === -1 && message.protected) {
        const preemptionLane = getPreemptionLane(lanes);
        if (preemptionLane !== -1) {
          this.removeItem(lanes[preemptionLane].blockingNormal);
          lanes = this.getLaneState();
          lane = getAvailableLane(lanes, candidate, gap);
        }
        if (lane === -1) {
          const now = performance.now();
          if (now - this.lastForcedPriorityTime < 350) return false;
          this.lastForcedPriorityTime = now;
          lanes = this.getLaneState();
          lane = lanes.reduce((best, current, index, values) => {
            if (best === -1) return index;
            return current.rightEdge < values[best].rightEdge ? index : best;
          }, -1);
        }
      }

      if (lane === -1) return false;

      const surface = this.createRenderSurfaceFromLayout(message, layout);
      const item = {
        ...candidate,
        duplicateKey,
        id: this.nextId++,
        lane,
        surface
      };

      this.active.push(item);
      this.diagnostics.spawned += 1;
      this.registerEmojiItem(item);
      if (duplicateKey) {
        const group = this.repeatGroups.get(duplicateKey);
        if (group) {
          group.rollingItems.push(item);
        } else {
          this.repeatGroups.set(duplicateKey, {
            fixedItem: null,
            rollingItems: [item],
            repeatCount: 0
          });
        }
      }
      this.requestRender();
      return true;
    }

    getMessageTime(message) {
      const messageTime = Number(message?.videoTime);
      if (Number.isFinite(messageTime)) return messageTime;
      const mediaTime = this.getMediaTime();
      if (mediaTime != null) return mediaTime;
      return performance.now() / 1000;
    }

    isMessageExpired(message, currentTime = this.getMediaTime()) {
      if (message?.__ydSpawnAtEntry) return false;
      const messageTime = Number(message?.videoTime);
      const stageWidth = this.stage.clientWidth;
      if (
        !Number.isFinite(messageTime)
        || !Number.isFinite(currentTime)
        || !(stageWidth > 0)
      ) return false;
      const duration = getBilibiliDanmakuDuration(stageWidth, this.options.speed);
      return (currentTime - messageTime) / normalizePlaybackRate(this.playbackRate) >= duration;
    }

    pruneExpiredQueueHead(queue, currentTime = this.getMediaTime()) {
      let expiredCount = 0;
      while (
        expiredCount < queue.length
        && this.isMessageExpired(queue[expiredCount], currentTime)
      ) {
        expiredCount += 1;
      }
      if (expiredCount) {
        queue.splice(0, expiredCount);
        this.diagnostics.expired += expiredCount;
      }
      return expiredCount;
    }

    getAvailableFixedLane() {
      const laneLimit = this.getFixedLaneLimit();
      const busyLanes = new Set(this.fixedActive.map((item) => item.lane));
      for (let lane = 0; lane < laneLimit; lane += 1) {
        if (!busyLanes.has(lane)) return lane;
      }
      return -1;
    }

    tryMergeDuplicate(message, duplicateKey) {
      const group = this.repeatGroups.get(duplicateKey);
      if (!group) return false;

      const mergeDuration = getBilibiliDanmakuDuration(
        this.stage.clientWidth,
        this.options.speed
      );
      const messageTime = this.getMessageTime(message);
      const fixedIsActive = group.fixedItem && this.fixedActive.includes(group.fixedItem);
      // Visibility advances on real frame time, so duplicate merging is independent of playbackRate.
      group.rollingItems = group.rollingItems.filter((item) => this.active.includes(item));
      if (!fixedIsActive && !group.rollingItems.length) {
        this.repeatGroups.delete(duplicateKey);
        return false;
      }

      const currentMediaTime = this.getMediaTime();
      const restoredAge = message.__ydSpawnAtEntry || currentMediaTime == null
        ? 0
        : Math.max(
          0,
          (currentMediaTime - messageTime) / normalizePlaybackRate(this.playbackRate)
        );
      if (restoredAge >= mergeDuration) {
        if (group.fixedItem) this.removeFixedItem(group.fixedItem);
        this.repeatGroups.delete(duplicateKey);
        return false;
      }

      if (fixedIsActive) {
        this.diagnostics.merged += 1;
        group.repeatCount += 1;
        group.fixedItem.repeatCount = group.repeatCount;
        group.fixedItem.counterSurface = this.createRepeatCounterSurface(group.repeatCount);
        group.fixedItem.elapsed = restoredAge;
        group.fixedItem.pulseElapsed = Math.min(
          restoredAge,
          REPEAT_COUNTER_PULSE_SECONDS
        );
        this.requestRender();
        return true;
      }

      group.repeatCount += 1;
      if (group.repeatCount < 2) return false;

      const lane = this.getAvailableFixedLane();
      if (lane === -1) return false;

      const fixedItem = {
        id: this.nextId++,
        duplicateKey,
        message,
        lane,
        repeatCount: group.repeatCount,
        bodySurface: this.createRenderSurface(message, {
          enhanceStroke: true,
          forceBold: true,
          fontScale: 1.12,
          preserveLaneGap: true
        }),
        counterSurface: this.createRepeatCounterSurface(group.repeatCount),
        duration: mergeDuration,
        elapsed: restoredAge,
        pulseElapsed: Math.min(restoredAge, REPEAT_COUNTER_PULSE_SECONDS)
      };
      group.fixedItem = fixedItem;
      this.fixedActive.push(fixedItem);
      this.updateStageHeight();
      this.diagnostics.merged += 1;
      this.registerEmojiItem(fixedItem);
      this.requestRender();
      return true;
    }

    getPixelRatio() {
      const ratio = Number(globalThis.devicePixelRatio);
      return Number.isFinite(ratio) && ratio > 0 ? Math.min(3, ratio) : 1;
    }

    getEmojiImage(src) {
      if (typeof Image !== 'function') return null;
      let record = this.imageCache.get(src);
      if (record) return record.loaded ? record.image : null;

      const image = new Image();
      record = { image, loaded: false, failed: false };
      this.imageCache.set(src, record);
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.onload = () => {
        record.loaded = true;
        this.queueEmojiSurfaceRebuild(src);
      };
      image.onerror = () => {
        record.failed = true;
      };
      image.src = src;
      return null;
    }

    registerEmojiItem(item) {
      if (!item) return;
      item.isActive = true;
      item.emojiSources = Array.from(new Set(
        item.message.segments
          .filter((segment) => segment.type === 'emoji')
          .map((segment) => segment.src)
      ));
      item.emojiSources.forEach((src) => {
        let items = this.emojiItemIndex.get(src);
        if (!items) {
          items = new Set();
          this.emojiItemIndex.set(src, items);
        }
        items.add(item);
      });
    }

    unregisterEmojiItem(item) {
      if (!item) return;
      item.isActive = false;
      this.pendingEmojiRebuilds.delete(item);
      (item.emojiSources || []).forEach((src) => {
        const items = this.emojiItemIndex.get(src);
        items?.delete(item);
        if (!items?.size) this.emojiItemIndex.delete(src);
      });
      item.emojiSources = [];
    }

    queueEmojiSurfaceRebuild(src) {
      this.emojiItemIndex.get(src)?.forEach((item) => {
        if (item.isActive) this.pendingEmojiRebuilds.add(item);
      });
      if (this.pendingEmojiRebuilds.size && this.emojiRebuildFrameId == null) {
        this.emojiRebuildFrameId = requestAnimationFrame(this.flushEmojiSurfaceRebuilds);
      }
    }

    flushEmojiSurfaceRebuilds() {
      this.emojiRebuildFrameId = null;
      const startedAt = performance.now();
      let rebuilt = 0;
      for (const item of this.pendingEmojiRebuilds) {
        this.pendingEmojiRebuilds.delete(item);
        if (!item.isActive) continue;
        if (item.bodySurface) {
          item.bodySurface = this.createRenderSurface(item.message, {
            enhanceStroke: true,
            forceBold: true,
            fontScale: 1.12,
            preserveLaneGap: true
          });
        } else {
          item.surface = this.createRenderSurface(item.message);
          item.width = item.surface.width;
          item.height = item.surface.height;
        }
        rebuilt += 1;
        if (
          rebuilt >= MAX_EMOJI_REBUILDS_PER_FRAME
          || performance.now() - startedAt >= MESSAGE_DRAIN_BUDGET_MS
        ) break;
      }
      if (this.pendingEmojiRebuilds.size) {
        this.emojiRebuildFrameId = requestAnimationFrame(this.flushEmojiSurfaceRebuilds);
      }
      if (rebuilt) this.requestRender();
    }

    clearEmojiTracking() {
      this.active.forEach((item) => { item.isActive = false; });
      this.fixedActive.forEach((item) => { item.isActive = false; });
      this.emojiItemIndex.clear();
      this.pendingEmojiRebuilds.clear();
      if (this.emojiRebuildFrameId != null) cancelAnimationFrame(this.emojiRebuildFrameId);
      this.emojiRebuildFrameId = null;
    }

    createRenderLayout(message, renderOptions = {}) {
      const baseFontSize = Math.max(
        1,
        Number(this.options.fontSize) || DEFAULT_ENGINE_OPTIONS.fontSize
      );
      const requestedScale = Math.max(1, Number(renderOptions.fontScale) || 1);
      const requestedFontSize = baseFontSize * requestedScale;
      const fontWeight = renderOptions.forceBold || this.options.bold ? 700 : 500;
      const fontFamily = this.options.fontFamily || 'sans-serif';
      const baseStrokeWidth = Math.max(0, Number(this.options.strokeWidth) || 0);
      let strokeWidth = baseStrokeWidth;
      const opacity = getOpacityChannels(this.options.opacity).fill;
      const lineHeight = this.getLineHeight();
      const measureContext = this.measureContext;
      const sampleText = message.segments
        .filter((segment) => segment.type === 'text')
        .map((segment) => segment.text)
        .join('') || '国Ag';
      const hasText = message.segments.some((segment) => segment.type === 'text');
      const hasEmoji = message.segments.some((segment) => segment.type === 'emoji');

      const measureContentHeight = (size) => {
        measureContext.font = `${fontWeight} ${size}px ${fontFamily}`;
        const metrics = measureContext.measureText(sampleText);
        const textHeight = Number(metrics.actualBoundingBoxAscent)
          + Number(metrics.actualBoundingBoxDescent);
        const estimatedTextHeight = Number.isFinite(textHeight) && textHeight > 0
          ? textHeight
          : size * 0.82;
        return {
          emoji: hasEmoji ? size * 1.15 : 0,
          text: hasText ? estimatedTextHeight : 0
        };
      };
      const measureInkHeight = (size, outlineWidth) => {
        const content = measureContentHeight(size);
        return Math.max(
          content.emoji,
          content.text ? content.text + outlineWidth * 2 : 0
        );
      };

      let fontSize = requestedFontSize;
      if (renderOptions.preserveLaneGap) {
        const minimumVerticalGap = Math.max(2, baseFontSize * 0.1);
        const availableInkHeight = Math.max(1, lineHeight - minimumVerticalGap);
        if (renderOptions.enhanceStroke) {
          const desiredStrokeWidth = baseStrokeWidth + Math.max(
            0.5,
            Math.min(1, baseStrokeWidth * 0.5 || 0.5)
          );
          const baseContentHeight = measureContentHeight(baseFontSize);
          const maximumStrokeAtBase = Math.max(
            baseStrokeWidth,
            (availableInkHeight - baseContentHeight.text) / 2
          );
          strokeWidth = Math.min(desiredStrokeWidth, maximumStrokeAtBase);
        }

        if (measureInkHeight(fontSize, strokeWidth) > availableInkHeight) {
          let low = baseFontSize;
          let high = requestedFontSize;
          for (let attempt = 0; attempt < 8; attempt += 1) {
            const candidate = (low + high) / 2;
            if (measureInkHeight(candidate, strokeWidth) <= availableInkHeight) {
              low = candidate;
            } else {
              high = candidate;
            }
          }
          fontSize = low;
        }
      } else if (renderOptions.enhanceStroke) {
        strokeWidth = baseStrokeWidth + 1;
      }

      const font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      const inkHeight = measureInkHeight(fontSize, strokeWidth);
      const verticalGap = Math.max(0, lineHeight - inkHeight);
      const padding = Math.ceil(strokeWidth + 2);
      measureContext.font = font;

      const emojiSize = fontSize * 1.15;
      const emojiMargin = fontSize * 0.08;
      const segments = message.segments.map((segment) => {
        if (segment.type === 'emoji') {
          return {
            ...segment,
            width: emojiSize + emojiMargin * 2
          };
        }
        return {
          ...segment,
          width: measureContext.measureText(segment.text).width
        };
      });

      let badge = null;
      if (message.role === 'owner' || message.role === 'moderator') {
        const label = message.authorName || (message.role === 'owner' ? '频道主' : '房管');
        const badgeFontSize = fontSize * 0.72;
        const badgeFont = `700 ${badgeFontSize}px ${fontFamily}`;
        measureContext.font = badgeFont;
        const labelWidth = measureContext.measureText(label).width;
        const iconWidth = message.role === 'moderator' ? badgeFontSize * 0.75 + 3 : 0;
        badge = {
          label,
          labelWidth,
          hasModeratorIcon: message.role === 'moderator',
          font: badgeFont,
          fontSize: badgeFontSize,
          foreground: normalizeColor(message.authorColor, '#ffffff'),
          background: normalizeColor(
            message.authorBackground,
            message.role === 'moderator' ? '#075e54' : '#b91c1c'
          ),
          width: labelWidth + iconWidth + 10,
          height: badgeFontSize + 6
        };
      }

      const contentWidth = segments.reduce((total, segment) => total + segment.width, 0);
      const badgeWidth = badge ? badge.width + 6 : 0;
      const width = Math.max(1, Math.ceil(padding * 2 + badgeWidth + contentWidth));
      const height = Math.max(1, lineHeight);
      return {
        badge,
        emojiMargin,
        emojiSize,
        font,
        fontSize,
        height,
        inkHeight,
        opacity,
        padding,
        segments,
        strokeWidth,
        verticalGap,
        width
      };
    }

    createRenderSurfaceFromLayout(message, layout) {
      const pixelRatio = this.getPixelRatio();
      const {
        badge,
        emojiMargin,
        emojiSize,
        font,
        fontSize,
        height,
        inkHeight,
        opacity,
        padding,
        segments,
        strokeWidth,
        verticalGap,
        width
      } = layout;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(width * pixelRatio));
      canvas.height = Math.max(1, Math.ceil(height * pixelRatio));
      const context = canvas.getContext('2d', { alpha: true });
      context.scale(pixelRatio, pixelRatio);
      context.imageSmoothingEnabled = true;
      context.globalAlpha = opacity;
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      context.lineCap = 'round';

      let cursorX = padding;
      const centerY = height / 2;
      if (badge) {
        const badgeY = centerY - badge.height / 2;
        const radius = Math.min(4, badge.height / 2);
        context.fillStyle = badge.background;
        context.beginPath();
        context.moveTo(cursorX + radius, badgeY);
        context.lineTo(cursorX + badge.width - radius, badgeY);
        context.quadraticCurveTo(cursorX + badge.width, badgeY, cursorX + badge.width, badgeY + radius);
        context.lineTo(cursorX + badge.width, badgeY + badge.height - radius);
        context.quadraticCurveTo(
          cursorX + badge.width,
          badgeY + badge.height,
          cursorX + badge.width - radius,
          badgeY + badge.height
        );
        context.lineTo(cursorX + radius, badgeY + badge.height);
        context.quadraticCurveTo(cursorX, badgeY + badge.height, cursorX, badgeY + badge.height - radius);
        context.lineTo(cursorX, badgeY + radius);
        context.quadraticCurveTo(cursorX, badgeY, cursorX + radius, badgeY);
        context.closePath();
        context.fill();
        context.font = badge.font;
        context.fillStyle = badge.foreground;
        context.fillText(badge.label, cursorX + 5, centerY);
        if (badge.hasModeratorIcon) {
          const iconX = cursorX + 5 + badge.labelWidth + 3;
          const iconRadius = badge.fontSize * 0.12;
          context.strokeStyle = badge.foreground;
          context.lineWidth = Math.max(1, badge.fontSize * 0.09);
          context.beginPath();
          context.moveTo(iconX + iconRadius, centerY - iconRadius);
          context.lineTo(iconX + badge.fontSize * 0.56, centerY + badge.fontSize * 0.3);
          context.stroke();
          context.beginPath();
          context.arc(iconX, centerY - iconRadius * 1.5, iconRadius, 0, Math.PI * 2);
          context.stroke();
        }
        cursorX += badge.width + 6;
      }

      context.font = font;
      context.strokeStyle = '#000000';
      context.fillStyle = normalizeColor(message.color, '#ffffff');
      context.lineWidth = strokeWidth;
      segments.forEach((segment) => {
        if (segment.type === 'emoji') {
          const image = this.getEmojiImage(segment.src);
          const imageX = cursorX + emojiMargin;
          if (image) {
            context.drawImage(image, imageX, centerY - emojiSize / 2, emojiSize, emojiSize);
          } else {
            context.save();
            context.globalAlpha *= 0.45;
            context.fillStyle = '#ffffff';
            context.fillRect(imageX, centerY - emojiSize / 2, emojiSize, emojiSize);
            context.restore();
          }
          cursorX += segment.width;
          return;
        }

        if (strokeWidth > 0) context.strokeText(segment.text, cursorX, centerY);
        context.fillText(segment.text, cursorX, centerY);
        cursorX += segment.width;
      });

      return {
        canvas,
        width,
        height,
        fontSize,
        inkHeight,
        strokeWidth,
        verticalGap
      };
    }

    createRenderSurface(message, renderOptions = {}) {
      const layout = this.createRenderLayout(message, renderOptions);
      return this.createRenderSurfaceFromLayout(message, layout);
    }

    createRepeatCounterSurface(repeatCount) {
      const pixelRatio = this.getPixelRatio();
      const baseFontSize = Math.max(
        1,
        Number(this.options.fontSize) || DEFAULT_ENGINE_OPTIONS.fontSize
      );
      const fontSize = Math.max(10, baseFontSize * 0.78);
      const fontFamily = this.options.fontFamily || 'sans-serif';
      const font = `700 ${fontSize}px ${fontFamily}`;
      const label = `+${Math.max(1, Math.floor(Number(repeatCount) || 1))}`;
      const outlineWidth = Math.max(2, fontSize * 0.12);
      const opacity = getOpacityChannels(this.options.opacity).fill;
      const lineHeight = this.getLineHeight();
      const padding = Math.ceil(outlineWidth + 3);
      const measureContext = this.measureContext;
      measureContext.font = font;
      const width = Math.max(
        1,
        Math.ceil(measureContext.measureText(label).width + padding * 2)
      );
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(width * pixelRatio));
      canvas.height = Math.max(1, Math.ceil(lineHeight * pixelRatio));
      const context = canvas.getContext('2d', { alpha: true });
      context.scale(pixelRatio, pixelRatio);
      context.globalAlpha = opacity;
      context.font = font;
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.lineWidth = outlineWidth;
      context.strokeStyle = '#18e56f';
      context.fillStyle = '#ffffff';
      context.strokeText(label, padding, lineHeight / 2);
      context.fillText(label, padding, lineHeight / 2);
      return { canvas, width, height: lineHeight, label };
    }

    requestRender() {
      if (
        this.inAnimationFrame
        || (this.enabled && !this.paused && this.frameId != null)
      ) return;
      this.renderFrame();
    }

    renderFrame() {
      if (!this.context) return;
      const width = this.stage.clientWidth;
      const height = this.stage.clientHeight;
      const pixelRatio = this.getPixelRatio();
      this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      this.context.clearRect(0, 0, width, height);
      const lineHeight = this.getLineHeight();
      const laneCount = this.getRenderLaneCount();
      this.active.forEach((item) => {
        item.lane = Math.min(item.lane, laneCount - 1);
        const x = alignToDevicePixel(item.x, pixelRatio);
        const y = alignToDevicePixel(item.lane * lineHeight, pixelRatio);
        this.context.drawImage(
          item.surface.canvas,
          x,
          y,
          item.surface.width,
          item.surface.height
        );
      });

      this.fixedActive.forEach((item) => {
        item.lane = Math.min(item.lane, laneCount - 1);
        const bodyX = alignToDevicePixel(
          (width - item.bodySurface.width) / 2,
          pixelRatio
        );
        const y = alignToDevicePixel(item.lane * lineHeight, pixelRatio);
        this.context.drawImage(
          item.bodySurface.canvas,
          bodyX,
          y,
          item.bodySurface.width,
          item.bodySurface.height
        );

        const pulseProgress = Math.min(
          1,
          item.pulseElapsed / REPEAT_COUNTER_PULSE_SECONDS
        );
        const pulseScale = 1 + (1 - pulseProgress) * 0.28;
        const counterWidth = item.counterSurface.width * pulseScale;
        const counterHeight = item.counterSurface.height * pulseScale;
        const counterGap = Math.max(6, this.options.fontSize * 0.24);
        const counterX = alignToDevicePixel(
          bodyX + item.bodySurface.width + counterGap
            - (counterWidth - item.counterSurface.width) / 2,
          pixelRatio
        );
        const counterY = alignToDevicePixel(
          y + (lineHeight - counterHeight) / 2
            - (1 - pulseProgress) * this.options.fontSize * 0.08,
          pixelRatio
        );
        this.context.drawImage(
          item.counterSurface.canvas,
          counterX,
          counterY,
          counterWidth,
          counterHeight
        );
      });
    }

    reflow(rebuildSurfaces = false) {
      if (!this.stage.isConnected) return;
      this.updateStageHeight();
      const width = this.stage.clientWidth;
      const height = this.stage.clientHeight;
      const pixelRatio = this.getPixelRatio();
      const physicalWidth = Math.max(1, Math.ceil(width * pixelRatio));
      const physicalHeight = Math.max(1, Math.ceil(height * pixelRatio));
      if (this.canvas.width !== physicalWidth) this.canvas.width = physicalWidth;
      if (this.canvas.height !== physicalHeight) this.canvas.height = physicalHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;

      const lineHeight = this.getLineHeight();
      const laneCount = this.getRenderLaneCount();
      this.active.forEach((item) => {
        item.lane %= laneCount;
        if (rebuildSurfaces) {
          item.surface = this.createRenderSurface(item.message);
          item.width = item.surface.width;
          item.height = item.surface.height;
        }
        item.duration = getBilibiliDanmakuDuration(width, this.options.speed);
        item.velocity = getBilibiliDanmakuVelocity(width, item.width, item.duration);
      });
      this.fixedActive.forEach((item) => {
        item.lane %= laneCount;
        item.duration = getBilibiliDanmakuDuration(width, this.options.speed);
        if (rebuildSurfaces) {
          item.bodySurface = this.createRenderSurface(item.message, {
            enhanceStroke: true,
            forceBold: true,
            fontScale: 1.12,
            preserveLaneGap: true
          });
          item.counterSurface = this.createRepeatCounterSurface(item.repeatCount);
        }
      });
      this.renderFrame();
    }

    clearActive() {
      this.clearEmojiTracking();
      this.active = [];
      this.fixedActive = [];
      this.updateStageHeight();
      this.repeatGroups.clear();
      this.normalQueue = [];
      this.priorityQueue = [];
      this.incomingNormalQueue = [];
      this.incomingPriorityQueue = [];
      this.renderFrame();
    }

    rebuildAtTime(messages, currentTime) {
      const targetTime = Number(currentTime);
      if (!Number.isFinite(targetTime)) return;

      this.clearActive();
      this.timeline = (Array.isArray(messages) ? messages : [])
        .map((message) => normalizeDanmakuMessage(message, null))
        .filter((message) => message && Number.isFinite(message.videoTime))
        .map((message) => ({ ...message, videoTime: Number(message.videoTime) }))
        .sort((left, right) => left.videoTime - right.videoTime);

      this.timelineCursor = this.timeline.findIndex((message) => message.videoTime > targetTime);
      if (this.timelineCursor === -1) this.timelineCursor = this.timeline.length;

      const visibleLookback = getBilibiliDanmakuDuration(
        this.stage.clientWidth,
        this.options.speed
      ) * normalizePlaybackRate(this.playbackRate);
      this.timeline
        .slice(0, this.timelineCursor)
        .filter((message) => message.videoTime >= targetTime - visibleLookback)
        .slice(-300)
        .forEach((message) => {
          const spawned = this.trySpawn(message);
          const isProtected = message.role === 'moderator' || message.role === 'owner';
          if (!spawned && isProtected) this.priorityQueue.push(message);
        });

      this.syncToMediaTime(targetTime);
    }

    spawnDueTimelineMessages(currentTime) {
      while (this.timelineCursor < this.timeline.length) {
        const message = this.timeline[this.timelineCursor];
        if (message.videoTime > currentTime) break;
        this.timelineCursor += 1;
        this.enqueueDeferred(message);
      }
    }

    syncToMediaTime(explicitTime) {
      const currentTime = Number.isFinite(Number(explicitTime))
        ? Number(explicitTime)
        : this.getMediaTime();
      if (currentTime == null) return;

      const stageWidth = this.stage.clientWidth;
      [...this.active].forEach((item) => {
        if (item.startTime == null) return;
        item.duration = getBilibiliDanmakuDuration(stageWidth, this.options.speed);
        item.velocity = getBilibiliDanmakuVelocity(stageWidth, item.width, item.duration);
        item.x = calculateBilibiliDanmakuX(
          stageWidth,
          item.width,
          item.duration,
          currentTime,
          item.startTime,
          this.playbackRate
        );
        if (item.x > stageWidth + 1 || item.x + item.width < 0) {
          this.removeItem(item);
        }
      });
      this.renderFrame();
    }

    drainQueues(maxMessages = MAX_MESSAGES_PER_FRAME, startedAt = performance.now()) {
      let attempts = 0;
      const currentMediaTime = this.getMediaTime();

      this.pruneExpiredQueueHead(this.priorityQueue, currentMediaTime);
      this.pruneExpiredQueueHead(this.normalQueue, currentMediaTime);

      while (
        this.priorityQueue.length
        && attempts < maxMessages
        && (attempts === 0 || performance.now() - startedAt < MESSAGE_DRAIN_BUDGET_MS)
      ) {
        attempts += 1;
        if (!this.trySpawn(this.priorityQueue[0])) break;
        this.priorityQueue.shift();
      }

      while (
        !this.priorityQueue.length
        && this.normalQueue.length
        && attempts < maxMessages
        && (attempts === 0 || performance.now() - startedAt < MESSAGE_DRAIN_BUDGET_MS)
      ) {
        attempts += 1;
        if (!this.trySpawn(this.normalQueue[0])) break;
        this.normalQueue.shift();
      }
      return attempts;
    }

    drainIncomingMessages(
      maxMessages = MAX_MESSAGES_PER_FRAME,
      startedAt = performance.now(),
      allowFirst = true
    ) {
      let attempts = 0;
      while (
        (this.incomingPriorityQueue.length || this.incomingNormalQueue.length)
        && attempts < maxMessages
        && (
          (allowFirst && attempts === 0)
          || performance.now() - startedAt < MESSAGE_DRAIN_BUDGET_MS
        )
      ) {
        const sourceQueue = this.incomingPriorityQueue.length
          ? this.incomingPriorityQueue
          : this.incomingNormalQueue;
        const message = sourceQueue[0];
        if (this.isMessageExpired(message)) {
          sourceQueue.shift();
          this.diagnostics.expired += 1;
          attempts += 1;
          continue;
        }
        const spawned = this.trySpawn(message);
        attempts += 1;
        if (spawned) {
          sourceQueue.shift();
          continue;
        }
        if (message.protected) {
          sourceQueue.shift();
          this.priorityQueue.push(message);
          break;
        }
        this.markDeferred(message);
        break;
      }
      return attempts;
    }

    tick(timestamp) {
      this.frameId = null;
      if (!this.enabled || this.paused) return;

      const frameWorkStartedAt = performance.now();
      const rawFrameGapMs = this.lastFrameTime == null
        ? 0
        : Math.max(0, timestamp - this.lastFrameTime);
      const delta = Math.min(0.05, rawFrameGapMs / 1000);
      this.diagnostics.frames += 1;
      if (this.lastFrameTime != null) {
        this.diagnostics.frameIntervals += 1;
        this.diagnostics.totalFrameGapMs += rawFrameGapMs;
        this.diagnostics.maxFrameGapMs = Math.max(
          this.diagnostics.maxFrameGapMs,
          rawFrameGapMs
        );
        if (rawFrameGapMs > 25) this.diagnostics.frameGapsOver25Ms += 1;
        if (rawFrameGapMs > 50) this.diagnostics.frameGapsOver50Ms += 1;
        if (rawFrameGapMs > 100) this.diagnostics.frameGapsOver100Ms += 1;
      }
      if (this.awaitingResumeFirstFrame) {
        this.diagnostics.resumeFirstFrames += 1;
        this.diagnostics.maxResumeFirstFrameDeltaMs = Math.max(
          this.diagnostics.maxResumeFirstFrameDeltaMs,
          delta * 1000
        );
        this.awaitingResumeFirstFrame = false;
      }
      this.lastFrameTime = timestamp;
      const currentMediaTime = this.getMediaTime();

      this.inAnimationFrame = true;
      try {
        if (currentMediaTime != null) this.spawnDueTimelineMessages(currentMediaTime);

        let removedRollingItem = false;
        for (let index = this.active.length - 1; index >= 0; index -= 1) {
          const item = this.active[index];
          // Media time only schedules messages and handles explicit seeks. On-screen motion
          // stays tied to real frame time so playbackRate cannot change its velocity.
          item.x = advanceDanmakuX(item.x, item.velocity, delta);
          if (item.x + item.width < 0) {
            this.active.splice(index, 1);
            this.unlinkRollingItem(item);
            removedRollingItem = true;
          }
        }
        if (removedRollingItem) this.updateStageHeight();

        for (let index = this.fixedActive.length - 1; index >= 0; index -= 1) {
          const item = this.fixedActive[index];
          item.elapsed += delta;
          item.pulseElapsed += delta;
          if (item.elapsed >= item.duration) this.removeFixedItem(item, false);
        }

        const drainStartedAt = performance.now();
        const drained = this.drainQueues(MAX_MESSAGES_PER_ANIMATION_FRAME, drainStartedAt);
        if (!this.priorityQueue.length && drained < MAX_MESSAGES_PER_ANIMATION_FRAME) {
          this.drainIncomingMessages(
            MAX_MESSAGES_PER_ANIMATION_FRAME - drained,
            drainStartedAt,
            drained === 0
          );
        }
      } finally {
        this.inAnimationFrame = false;
      }

      this.renderFrame();
      const frameWorkMs = performance.now() - frameWorkStartedAt;
      this.diagnostics.totalFrameWorkMs += frameWorkMs;
      this.diagnostics.maxFrameWorkMs = Math.max(
        this.diagnostics.maxFrameWorkMs,
        frameWorkMs
      );
      if (frameWorkMs > 4) this.diagnostics.frameWorkOver4Ms += 1;
      if (frameWorkMs > 8) this.diagnostics.frameWorkOver8Ms += 1;
      if (frameWorkMs > 16) this.diagnostics.frameWorkOver16Ms += 1;
      this.publishDiagnostics(false, timestamp);
      this.frameId = requestAnimationFrame(this.tick);
    }

    syncAnimationLoop() {
      if (this.enabled && !this.paused) {
        if (this.frameId == null) {
          this.frameId = requestAnimationFrame(this.tick);
        }
        return;
      }

      if (this.frameId != null) cancelAnimationFrame(this.frameId);
      this.frameId = null;
      this.lastFrameTime = null;
    }

    removeItem(item) {
      if (!item) return;
      const index = this.active.indexOf(item);
      if (index !== -1) {
        this.active.splice(index, 1);
        this.unlinkRollingItem(item);
        this.updateStageHeight();
      }
      this.requestRender();
    }

    unlinkRollingItem(item) {
      this.unregisterEmojiItem(item);
      const duplicateKey = item?.duplicateKey;
      if (!duplicateKey) return;
      const group = this.repeatGroups.get(duplicateKey);
      if (!group) return;
      const rollingIndex = group.rollingItems.indexOf(item);
      if (rollingIndex !== -1) group.rollingItems.splice(rollingIndex, 1);
      if (!group.rollingItems.length && !group.fixedItem) {
        this.repeatGroups.delete(duplicateKey);
      }
    }

    removeFixedItem(item, shouldRender = true) {
      if (!item) return;
      this.unregisterEmojiItem(item);
      const index = this.fixedActive.indexOf(item);
      if (index !== -1) this.fixedActive.splice(index, 1);
      this.updateStageHeight();
      const group = this.repeatGroups.get(item.duplicateKey);
      if (group?.fixedItem === item) this.repeatGroups.delete(item.duplicateKey);
      if (shouldRender) this.requestRender();
    }

    destroy() {
      if (this.frameId != null) cancelAnimationFrame(this.frameId);
      this.resizeObserver?.disconnect();
      this.clearEmojiTracking();
      this.active = [];
      this.fixedActive = [];
      this.repeatGroups.clear();
      this.normalQueue = [];
      this.priorityQueue = [];
      this.incomingNormalQueue = [];
      this.incomingPriorityQueue = [];
      this.timeline = [];
      this.timelineCursor = 0;
      this.imageCache.clear();
      this.canvas.remove();
    }
  }

  return {
    DEFAULT_ENGINE_OPTIONS,
    DanmakuEngine,
    advanceDanmakuX,
    alignToDevicePixel,
    calculateBilibiliDanmakuX,
    calculateDanmakuX,
    getBilibiliDanmakuDuration,
    getBilibiliDanmakuVelocity,
    getOpacityChannels,
    getAvailableLane,
    getDuplicateKey,
    getFixedMergeLaneLimit,
    getTemporaryLaneExpansion,
    getPreemptionLane,
    isSafeImageUrl,
    normalizeDanmakuMessage,
    normalizeMessageSegments,
    willDanmakuCollide
  };
});
