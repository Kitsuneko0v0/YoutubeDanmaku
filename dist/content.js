(function bootstrapYouTubeDanmaku() {
  'use strict';

  const MESSAGE_SOURCE = 'youtube-danmaku-extension';
  const CHAT_SELECTOR = [
    'yt-live-chat-text-message-renderer',
    'yt-live-chat-paid-message-renderer',
    'yt-live-chat-membership-item-renderer'
  ].join(',');
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    hideChatInFullscreen: false,
    area: 50,
    opacity: 70,
    fontSize: 24,
    speed: 1,
    fontFamily: 'sans-serif',
    bold: false,
    strokeWidth: 2
  });
  const SETTINGS_SAVE_DELAY_MS = 250;
  const CHAT_REPLAY_LATE_TOLERANCE_SECONDS = 3;
  const CHAT_BRIDGE_MAX_MESSAGES_PER_SLICE = 2;
  const CHAT_BRIDGE_PARSE_BUDGET_MS = 2;
  const CHAT_BRIDGE_MAX_BATCH_MESSAGES = 4;
  const CHAT_BRIDGE_MAX_PENDING_WORK = 1000;
  const CHAT_BRIDGE_MAX_INCOMPLETE_RETRIES = 4;
  const CHAT_BRIDGE_REATTACH_INTERVAL_MS = 1000;
  const FONT_FAMILIES = new Set([
    'sans-serif',
    'Arial, sans-serif',
    '"Noto Sans", sans-serif',
    '"Microsoft YaHei", "PingFang SC", sans-serif'
  ]);
  const CHAT_MESSAGE_LIMITS = Object.freeze({
    id: 1024,
    videoId: 256,
    text: 4096,
    authorName: 512,
    segments: 200,
    segmentText: 4096,
    imageUrl: 4096,
    totalContent: 16384,
    color: 256
  });

  const DANMAKU_ICON = '<rect x="3.5" y="5.5" width="21" height="17" rx="2.5"/><path d="M8 10h11M6.5 14h13M9 18h10"/><circle cx="6.5" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="21.5" cy="18" r="1" fill="currentColor" stroke="none"/>';
  const ICONS = Object.freeze({
    danmakuOn: `<svg viewBox="0 0 28 28" aria-hidden="true">${DANMAKU_ICON}<circle cx="21" cy="21" r="5.4" fill="#0f0f0f" opacity=".92" stroke="none"/><path d="m18.3 20.9 1.8 1.8 3.7-4.2" stroke-width="1.9"/></svg>`,
    danmakuOff: `<svg viewBox="0 0 28 28" aria-hidden="true">${DANMAKU_ICON}<circle cx="21" cy="21" r="5.4" fill="#0f0f0f" opacity=".92" stroke="none"/><circle cx="21" cy="21" r="3.8"/><path d="m18.4 18.4 5.2 5.2" stroke-width="1.7"/></svg>`,
    danmakuSettings: `<svg viewBox="0 0 28 28" aria-hidden="true">${DANMAKU_ICON}<circle cx="21" cy="21" r="6" fill="#0f0f0f" opacity=".92" stroke="none"/><circle cx="21" cy="21" r="2.5"/><path d="M21 16.6v1.2M21 24.2v1.2M16.6 21h1.2M24.2 21h1.2M17.9 17.9l.9.9M23.2 23.2l.9.9M24.1 17.9l-.9.9M18.8 23.2l-.9.9" stroke-width="1.45"/></svg>`,
    close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"/></svg>'
  });

  function getVideoIdFromUrl(value) {
    try {
      const url = new URL(value, location.origin);
      const queryVideoId = url.searchParams.get('v')?.trim();
      if (queryVideoId) return queryVideoId;

      const pathMatch = url.pathname.match(/^\/(?:live|shorts|embed)\/([^/?#]+)/);
      if (pathMatch) return pathMatch[1];
      if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
      return '';
    } catch {
      return '';
    }
  }

  function getCurrentVideoId() {
    return getVideoIdFromUrl(location.href);
  }

  function isSupportedVideoPage(pathname) {
    return pathname === '/watch' || /^\/live\/[^/]+\/?$/.test(pathname);
  }

  function normalizeSteppedNumber(value, fallback, min, max, step) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const clamped = Math.min(max, Math.max(min, parsed));
    const stepped = min + Math.round((clamped - min) / step) * step;
    return Number(Math.min(max, Math.max(min, stepped)).toFixed(4));
  }

  function normalizeSettings(value) {
    const settings = value && typeof value === 'object' ? value : {};
    return {
      enabled: typeof settings.enabled === 'boolean'
        ? settings.enabled
        : DEFAULT_SETTINGS.enabled,
      hideChatInFullscreen: typeof settings.hideChatInFullscreen === 'boolean'
        ? settings.hideChatInFullscreen
        : DEFAULT_SETTINGS.hideChatInFullscreen,
      area: normalizeSteppedNumber(settings.area, DEFAULT_SETTINGS.area, 25, 100, 25),
      opacity: normalizeSteppedNumber(settings.opacity, DEFAULT_SETTINGS.opacity, 0, 100, 1),
      fontSize: normalizeSteppedNumber(settings.fontSize, DEFAULT_SETTINGS.fontSize, 12, 40, 1),
      speed: normalizeSteppedNumber(settings.speed, DEFAULT_SETTINGS.speed, 0.1, 2, 0.1),
      fontFamily: FONT_FAMILIES.has(settings.fontFamily)
        ? settings.fontFamily
        : DEFAULT_SETTINGS.fontFamily,
      bold: typeof settings.bold === 'boolean' ? settings.bold : DEFAULT_SETTINGS.bold,
      strokeWidth: normalizeSteppedNumber(
        settings.strokeWidth,
        DEFAULT_SETTINGS.strokeWidth,
        0,
        4,
        0.5
      )
    };
  }

  function parseChatReplayTimestamp(value) {
    if (typeof value !== 'string') return null;
    const parts = value.trim().split(':');
    if (parts.length < 2 || parts.length > 3) return null;
    const numbers = parts.map((part) => Number(part));
    if (numbers.some((part) => !Number.isInteger(part) || part < 0)) return null;
    if (numbers.slice(1).some((part) => part >= 60)) return null;
    return numbers.reduce((total, part) => total * 60 + part, 0);
  }

  function getMonotonicTime() {
    return typeof globalThis.performance?.now === 'function'
      ? globalThis.performance.now()
      : Date.now();
  }

  function createChatBridgeDiagnostics() {
    return {
      mutationCallbacks: 0,
      maxMutationBatchSize: 0,
      queuedRenderers: 0,
      processedRenderers: 0,
      parseAttempts: 0,
      incompleteRetries: 0,
      duplicateNodes: 0,
      invalidMessages: 0,
      wrapperScans: 0,
      slices: 0,
      totalParseMs: 0,
      maxParseMs: 0,
      maxSliceMs: 0,
      queuePeak: 0,
      postedMessages: 0,
      postedBatches: 0,
      overflowed: 0
    };
  }

  function isValidChatMessagePayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (
      typeof payload.id !== 'string'
      || !payload.id
      || payload.id.length > CHAT_MESSAGE_LIMITS.id
    ) return false;
    if (
      payload.videoId != null
      && (
        typeof payload.videoId !== 'string'
        || payload.videoId.length > CHAT_MESSAGE_LIMITS.videoId
      )
    ) return false;
    if (
      payload.videoTime != null
      && (!Number.isFinite(Number(payload.videoTime)) || Number(payload.videoTime) < 0)
    ) return false;
    if (
      payload.text != null
      && (typeof payload.text !== 'string' || payload.text.length > CHAT_MESSAGE_LIMITS.text)
    ) return false;
    if (
      payload.authorName != null
      && (
        typeof payload.authorName !== 'string'
        || payload.authorName.length > CHAT_MESSAGE_LIMITS.authorName
      )
    ) return false;
    if (
      payload.role != null
      && !['viewer', 'moderator', 'owner'].includes(payload.role)
    ) return false;
    if (
      [payload.color, payload.authorColor, payload.authorBackground]
        .some((color) => color != null && (
          typeof color !== 'string' || color.length > CHAT_MESSAGE_LIMITS.color
        ))
    ) return false;
    if (!Array.isArray(payload.segments) || payload.segments.length > CHAT_MESSAGE_LIMITS.segments) {
      return false;
    }
    let totalContentLength = 0;
    return payload.segments.every((segment) => {
      if (!segment || typeof segment !== 'object') return false;
      if (segment.type === 'text') {
        if (
          typeof segment.text !== 'string'
          || segment.text.length > CHAT_MESSAGE_LIMITS.segmentText
        ) return false;
        totalContentLength += segment.text.length;
        return totalContentLength <= CHAT_MESSAGE_LIMITS.totalContent;
      }
      if (segment.type === 'emoji') {
        if (
          typeof segment.src !== 'string'
          || segment.src.length > CHAT_MESSAGE_LIMITS.imageUrl
          || (segment.alt != null && (
            typeof segment.alt !== 'string'
            || segment.alt.length > CHAT_MESSAGE_LIMITS.segmentText
          ))
        ) return false;
        totalContentLength += segment.alt?.length || 1;
        return totalContentLength <= CHAT_MESSAGE_LIMITS.totalContent;
      }
      return false;
    });
  }

  function storageGet(defaults) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
        try {
          resolve({ ...defaults, ...JSON.parse(localStorage.getItem('youtube-danmaku-settings') || '{}') });
        } catch (_) {
          resolve({ ...defaults });
        }
        return;
      }
      chrome.storage.sync.get(defaults, (value) => {
        const failed = Boolean(chrome.runtime?.lastError);
        if (failed) console.warn('Unable to load YouTube danmaku settings.');
        resolve(failed ? { ...defaults } : value || { ...defaults });
      });
    });
  }

  function storageSet(value) {
    return new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
          localStorage.setItem('youtube-danmaku-settings', JSON.stringify(value));
          resolve(true);
          return;
        }
        chrome.storage.sync.set(value, () => {
          const failed = Boolean(chrome.runtime?.lastError);
          if (failed) console.warn('Unable to save YouTube danmaku settings.');
          resolve(!failed);
        });
      } catch (_) {
        console.warn('Unable to save YouTube danmaku settings.');
        resolve(false);
      }
    });
  }

  function extractMessageSegments(element) {
    if (!element) return [];
    const segments = [];
    const appendText = (value) => {
      if (!value) return;
      const previous = segments[segments.length - 1];
      if (previous?.type === 'text') previous.text += value;
      else segments.push({ type: 'text', text: value });
    };
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        appendText(node.textContent || '');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches('script, style')) return;
      if (node.tagName === 'IMG') {
        const src = node.currentSrc || node.src || node.getAttribute('src');
        const alt = node.getAttribute('alt') || '';
        if (src) segments.push({ type: 'emoji', src, alt });
        else appendText(alt);
        return;
      }
      node.childNodes.forEach(visit);
    };

    element.childNodes.forEach(visit);
    return segments;
  }

  function extractText(element) {
    return extractMessageSegments(element)
      .map((segment) => segment.type === 'text' ? segment.text : segment.alt)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function detectAuthorRole(node) {
    const declared = node.getAttribute('author-type');
    if (declared === 'owner' || declared === 'moderator') return declared;

    const badgeText = Array.from(node.querySelectorAll('#author-badges [aria-label], yt-live-chat-author-badge-renderer'))
      .map((badge) => `${badge.getAttribute('type') || ''} ${badge.getAttribute('aria-label') || ''}`.toLowerCase())
      .join(' ');
    if (/moderator|管理员|房管/.test(badgeText)) return 'moderator';
    if (/owner|频道所有者|頻道擁有者|房主/.test(badgeText)) return 'owner';
    return 'viewer';
  }

  class ChatFrameBridge {
    constructor() {
      this.seen = new Set();
      this.observer = null;
      this.containerObserver = null;
      this.connectionTimer = null;
      this.drainTimer = null;
      this.pendingWork = [];
      this.queuedRenderers = new WeakSet();
      this.queuedScans = new WeakSet();
      this.diagnostics = createChatBridgeDiagnostics();
      this.sequence = 1;
    }

    start() {
      this.findAndObserve();
      this.connectionTimer = setInterval(() => {
        if (!this.observer?.target?.isConnected) this.findAndObserve();
      }, CHAT_BRIDGE_REATTACH_INTERVAL_MS);
    }

    findAndObserve() {
      const list = document.querySelector('yt-live-chat-item-list-renderer #items, #items.yt-live-chat-item-list-renderer');
      if (!list || this.observer?.target === list) return;
      this.observer?.disconnect();
      this.containerObserver?.disconnect();

      Array.from(list.querySelectorAll(CHAT_SELECTOR))
        .slice(-30)
        .forEach((node) => this.queueRenderer(node));
      this.observer = new MutationObserver((records) => {
        let addedElements = 0;
        this.diagnostics.mutationCallbacks += 1;
        records.forEach((record) => {
          record.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            addedElements += 1;
            this.queueAddedNode(node);
          });
        });
        this.diagnostics.maxMutationBatchSize = Math.max(
          this.diagnostics.maxMutationBatchSize,
          addedElements
        );
      });
      this.observer.target = list;
      this.observer.observe(list, { childList: true, subtree: false });

      if (list.parentElement) {
        this.containerObserver = new MutationObserver(() => {
          if (!list.isConnected) this.findAndObserve();
        });
        this.containerObserver.observe(list.parentElement, { childList: true, subtree: false });
      }
      window.top.postMessage({
        source: MESSAGE_SOURCE,
        type: 'chat-ready',
        videoId: getCurrentVideoId()
      }, location.origin);
    }

    now() {
      return getMonotonicTime();
    }

    queueAddedNode(node) {
      if (node.matches?.(CHAT_SELECTOR)) {
        this.queueRenderer(node);
        return;
      }
      if (this.queuedScans.has(node)) return;
      this.queuedScans.add(node);
      this.pushWork({ type: 'scan', node });
    }

    queueRenderer(node, prepend = false, schedule = true) {
      if (!node || this.queuedRenderers.has(node)) {
        if (node) this.diagnostics.duplicateNodes += 1;
        return;
      }
      this.queuedRenderers.add(node);
      this.diagnostics.queuedRenderers += 1;
      this.pushWork({ type: 'renderer', node, attempts: 0 }, prepend, schedule);
    }

    pushWork(work, prepend = false, schedule = true) {
      if (prepend) this.pendingWork.unshift(work);
      else this.pendingWork.push(work);
      if (this.pendingWork.length > CHAT_BRIDGE_MAX_PENDING_WORK) {
        if (prepend) this.pendingWork.pop();
        else this.pendingWork.shift();
        this.diagnostics.overflowed += 1;
      }
      this.diagnostics.queuePeak = Math.max(
        this.diagnostics.queuePeak,
        this.pendingWork.length
      );
      if (schedule) this.scheduleDrain();
    }

    scheduleDrain() {
      if (this.drainTimer != null) return;
      this.drainTimer = setTimeout(() => this.drainQueue(), 0);
    }

    drainQueue() {
      this.drainTimer = null;
      const startedAt = this.now();
      const payloads = [];
      let processedRenderers = 0;
      let processedWork = 0;
      let shouldYield = false;

      while (this.pendingWork.length) {
        const work = this.pendingWork.shift();
        processedWork += 1;
        if (work.type === 'scan') {
          this.diagnostics.wrapperScans += 1;
          const renderers = Array.from(work.node.querySelectorAll?.(CHAT_SELECTOR) || []);
          for (let index = renderers.length - 1; index >= 0; index -= 1) {
            this.queueRenderer(renderers[index], true, false);
          }
        } else {
          const parseStartedAt = this.now();
          const result = this.parseNode(work.node);
          const parseMs = Math.max(0, this.now() - parseStartedAt);
          this.diagnostics.parseAttempts += 1;
          this.diagnostics.totalParseMs += parseMs;
          this.diagnostics.maxParseMs = Math.max(this.diagnostics.maxParseMs, parseMs);
          if (
            result.incomplete
            && work.node.isConnected
            && work.attempts < CHAT_BRIDGE_MAX_INCOMPLETE_RETRIES
          ) {
            work.attempts += 1;
            this.pendingWork.push(work);
            this.diagnostics.incompleteRetries += 1;
            shouldYield = true;
          } else {
            if (result.incomplete) this.diagnostics.invalidMessages += 1;
            this.diagnostics.processedRenderers += 1;
            processedRenderers += 1;
            if (result.payload) payloads.push(result.payload);
          }
        }

        const elapsed = this.now() - startedAt;
        if (
          processedRenderers >= CHAT_BRIDGE_MAX_MESSAGES_PER_SLICE
          || (processedWork > 0 && elapsed >= CHAT_BRIDGE_PARSE_BUDGET_MS)
          || shouldYield
        ) break;
      }

      const sliceMs = Math.max(0, this.now() - startedAt);
      this.diagnostics.slices += 1;
      this.diagnostics.maxSliceMs = Math.max(this.diagnostics.maxSliceMs, sliceMs);
      if (payloads.length) this.postBatch(payloads);
      if (this.pendingWork.length) this.scheduleDrain();
    }

    parseNode(node) {
      if (node.id && this.seen.has(node.id)) {
        this.diagnostics.duplicateNodes += 1;
        return { incomplete: false, payload: null };
      }
      const messageElement = node.querySelector('#message');
      if (
        !messageElement
        && node.matches('yt-live-chat-membership-item-renderer')
        && node.querySelector('#header-subtext')
      ) {
        return { incomplete: false, payload: null };
      }
      const segments = extractMessageSegments(messageElement);
      if (!segments.length) {
        return { incomplete: true, payload: null };
      }
      const text = segments
        .map((segment) => segment.type === 'text' ? segment.text : segment.alt)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

      const authorElement = node.querySelector('#author-name');
      const authorName = authorElement?.textContent?.trim() || '';
      const id = node.id || `${authorName}:${text || '[emoji]'}:${this.sequence++}`;
      if (this.seen.has(id)) {
        this.diagnostics.duplicateNodes += 1;
        return { incomplete: false, payload: null };
      }
      this.seen.add(id);
      if (this.seen.size > 600) this.seen.delete(this.seen.values().next().value);

      const role = detectAuthorRole(node);
      const isPaid = node.matches('yt-live-chat-paid-message-renderer');
      const authorStyle = role !== 'viewer' && authorElement
        ? getComputedStyle(authorElement)
        : null;
      const nodeStyle = isPaid ? getComputedStyle(node) : null;
      const color = isPaid
        ? nodeStyle.getPropertyValue('--yt-live-chat-paid-message-primary-color').trim()
        : '#ffffff';
      const videoTime = parseChatReplayTimestamp(
        node.querySelector('#timestamp')?.textContent || ''
      );

      return {
        incomplete: false,
        payload: {
          id,
          videoId: getCurrentVideoId(),
          videoTime,
          text,
          segments,
          role,
          authorName,
          authorColor: role === 'moderator' ? '#ffffff' : authorStyle?.color || '#ffffff',
          authorBackground: role === 'moderator'
            ? authorStyle?.color || '#075e54'
            : authorStyle?.backgroundColor || '#b91c1c',
          color
        }
      };
    }

    postBatch(payloads) {
      const batch = payloads.slice(0, CHAT_BRIDGE_MAX_BATCH_MESSAGES);
      this.diagnostics.postedMessages += batch.length;
      this.diagnostics.postedBatches += 1;
      window.top.postMessage({
        source: MESSAGE_SOURCE,
        type: 'chat-message-batch',
        payloads: batch,
        diagnostics: {
          ...this.diagnostics,
          queuedWork: this.pendingWork.length
        }
      }, location.origin);
    }
  }

  class YouTubeDanmakuApp {
    constructor() {
      const translate = globalThis.YTDanmakuI18n?.createTranslator?.();
      this.settings = { ...DEFAULT_SETTINGS };
      this.t = typeof translate === 'function' ? translate : (key) => key;
      this.locale = translate?.locale || 'en';
      this.player = null;
      this.video = null;
      this.videoId = '';
      this.engine = null;
      this.controls = null;
      this.stage = null;
      this.panel = null;
      this.mountObserver = null;
      this.fullscreenObserver = null;
      this.abortController = null;
      this.mountTimer = null;
      this.chatRefreshTimer = null;
      this.chatRefreshPending = false;
      this.settingsSaveTimer = null;
      this.playerWasFullscreen = false;
      this.seenMessages = new Set();
      this.timelineMessages = [];
      this.pendingMessages = [];
      this.bridgeDiagnostics = null;
      this.lastObservedMediaTime = null;
      this.lastObservedMediaAt = null;
      this.handleWindowMessage = this.handleWindowMessage.bind(this);
      this.scheduleMount = this.scheduleMount.bind(this);
    }

    async start() {
      window.addEventListener('message', this.handleWindowMessage);
      this.settings = normalizeSettings(await storageGet(DEFAULT_SETTINGS));
      window.addEventListener('yt-navigate-finish', this.scheduleMount);
      window.addEventListener('yt-page-data-updated', this.scheduleMount);
      window.addEventListener('popstate', this.scheduleMount);
      this.mountObserver = new MutationObserver(() => {
        if (
          !this.player
          || !this.controls?.isConnected
          || !this.stage?.isConnected
          || this.videoId !== getCurrentVideoId()
        ) {
          this.scheduleMount();
        }
      });
      this.mountObserver.observe(document.documentElement, { childList: true, subtree: true });
      this.scheduleMount();
    }

    scheduleMount() {
      if (this.mountTimer != null) return;
      this.mountTimer = setTimeout(() => {
        this.mountTimer = null;
        this.mount();
      }, 120);
    }

    mount() {
      if (!isSupportedVideoPage(location.pathname)) {
        this.unmountPlayer();
        return false;
      }

      const videoId = getCurrentVideoId();
      if (this.player && this.videoId !== videoId) this.unmountPlayer();
      const player = document.getElementById('movie_player');
      const rightControls = player?.querySelector('.ytp-right-controls');
      const video = player?.querySelector('video');
      if (!player || !rightControls || !video) return false;
      if (this.player === player && this.controls?.isConnected && this.stage?.isConnected) {
        if (!this.panel?.hidden) this.positionSettingsPanel();
        return true;
      }
      return this.mountElements(player, rightControls, video, videoId);
    }

    mountElements(player, rightControls, video, videoId = getCurrentVideoId()) {
      this.unmountPlayer();
      this.player = player;
      this.video = video;
      this.videoId = videoId;
      this.abortController = new AbortController();
      const { signal } = this.abortController;

      this.stage = document.createElement('div');
      this.stage.className = 'yd-danmaku-stage';
      this.stage.setAttribute('aria-hidden', 'true');
      player.prepend(this.stage);
      this.publishChatBridgeDiagnostics();

      this.controls = this.createControls();
      rightControls.prepend(this.controls);
      this.panel = this.createSettingsPanel();
      player.append(this.panel);

      this.engine = new globalThis.YTDanmakuCore.DanmakuEngine(this.stage, this.toEngineOptions());
      this.engine.setMediaClock(() => this.video?.currentTime);
      this.engine.setPlaybackRate(video.playbackRate);
      this.engine.setEnabled(this.settings.enabled);
      this.engine.setPaused(video.paused);
      this.recordMediaTimeObservation();
      this.flushPendingMessages(videoId);
      this.updateChatVisibility();

      this.fullscreenObserver = new MutationObserver(() => this.updateChatVisibility());
      this.fullscreenObserver.observe(player, { attributes: true, attributeFilter: ['class'] });

      video.addEventListener('playing', () => this.engine?.setPaused(false), { signal });
      video.addEventListener('pause', () => this.engine?.setPaused(true), { signal });
      video.addEventListener('waiting', () => this.engine?.setPaused(true), { signal });
      video.addEventListener('ended', () => this.engine?.setPaused(true), { signal });
      video.addEventListener('ratechange', () => {
        this.engine?.setPlaybackRate(video.playbackRate);
        this.recordMediaTimeObservation();
      }, { signal });
      video.addEventListener('seeking', () => {
        this.engine?.syncToMediaTime();
      }, { signal });
      video.addEventListener('seeked', () => {
        this.rebuildDanmakuTimeline();
        this.recordMediaTimeObservation();
      }, { signal });
      video.addEventListener('timeupdate', () => {
        if (video.seeking) {
          this.engine?.syncToMediaTime();
          return;
        }
        this.handleMediaTimeUpdate();
      }, { signal });
      document.addEventListener('pointerdown', (event) => {
        if (this.panel?.hidden) return;
        if (!this.panel.contains(event.target) && !this.controls.contains(event.target)) this.setPanelOpen(false);
      }, { signal, capture: true });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') this.setPanelOpen(false);
      }, { signal });
      window.addEventListener('resize', () => {
        if (!this.panel?.hidden) this.positionSettingsPanel();
      }, { signal });
      document.addEventListener('fullscreenchange', () => {
        this.updateChatVisibility();
        if (!this.panel?.hidden) requestAnimationFrame(() => this.positionSettingsPanel());
      }, { signal });
      document.addEventListener('webkitfullscreenchange', () => {
        this.updateChatVisibility();
      }, { signal });
      return true;
    }

    toEngineOptions() {
      return {
        area: this.settings.area,
        opacity: this.settings.opacity / 100,
        fontSize: this.settings.fontSize,
        speed: this.settings.speed,
        fontFamily: this.settings.fontFamily,
        bold: this.settings.bold,
        strokeWidth: this.settings.strokeWidth
      };
    }

    createButton(label, icon, onClick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ytp-button yd-control-button';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = icon;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
      });
      return button;
    }

    createControls() {
      const controls = document.createElement('div');
      controls.className = 'yd-controls';
      const settings = this.createButton(
        this.t('settingsButton'),
        ICONS.danmakuSettings,
        () => this.setPanelOpen(this.panel?.hidden !== false)
      );
      settings.dataset.action = 'settings';
      controls.append(settings);
      return controls;
    }

    createSettingsPanel() {
      const panel = document.createElement('section');
      panel.className = 'yd-settings-panel';
      panel.hidden = true;
      panel.lang = this.locale;
      panel.setAttribute('aria-label', this.t('settingsTitle'));
      panel.innerHTML = `
        <div class="yd-settings-header">
          <h2 class="yd-settings-title">${this.t('settingsTitle')}</h2>
          <button class="yd-settings-close" type="button" aria-label="${this.t('closeSettings')}">${ICONS.close}</button>
        </div>
        <label class="yd-setting-toggle-row" for="yd-setting-enabled">
          <span class="yd-setting-label">${this.t('enableDanmaku')}</span>
          <span class="yd-switch">
            <input id="yd-setting-enabled" data-setting="enabled" type="checkbox" role="switch">
            <span class="yd-switch-track" aria-hidden="true"></span>
          </span>
        </label>
        <label class="yd-setting-toggle-row" for="yd-setting-hide-chat-in-fullscreen">
          <span class="yd-setting-label">${this.t('hideChatInFullscreen')}</span>
          <span class="yd-switch">
            <input id="yd-setting-hide-chat-in-fullscreen" data-setting="hideChatInFullscreen" type="checkbox" role="switch">
            <span class="yd-switch-track" aria-hidden="true"></span>
          </span>
        </label>
        ${this.rangeTemplate('area', this.t('displayArea'), 25, 100, 25, this.settings.area)}
        ${this.rangeTemplate('opacity', this.t('opacity'), 0, 100, 1, this.settings.opacity)}
        ${this.rangeTemplate('fontSize', this.t('fontSize'), 12, 40, 1, this.settings.fontSize)}
        ${this.rangeTemplate('speed', this.t('speed'), 0.1, 2, 0.1, this.settings.speed)}
        <div class="yd-setting-section">
          <div class="yd-setting-label">${this.t('fontFamily')}</div>
          <div class="yd-setting-font-row">
            <select class="yd-setting-select" data-setting="fontFamily" aria-label="${this.t('fontFamily')}">
              <option value="sans-serif">${this.t('defaultFont')}</option>
              <option value="Arial, sans-serif">Arial</option>
              <option value="&quot;Noto Sans&quot;, sans-serif">Noto Sans</option>
              <option value="&quot;Microsoft YaHei&quot;, &quot;PingFang SC&quot;, sans-serif">${this.t('systemCjkFont')}</option>
            </select>
            <label class="yd-check-label"><input data-setting="bold" type="checkbox">${this.t('bold')}</label>
          </div>
        </div>
        <div class="yd-setting-section">
          ${this.rangeTemplate('strokeWidth', this.t('strokeWidth'), 0, 4, 0.5, this.settings.strokeWidth)}
        </div>`;

      panel.querySelector('.yd-settings-close').addEventListener('click', () => this.setPanelOpen(false));
      const enabled = panel.querySelector('[data-setting="enabled"]');
      enabled.checked = this.settings.enabled;
      enabled.addEventListener('change', () => this.setEnabled(enabled.checked));
      const hideChatInFullscreen = panel.querySelector('[data-setting="hideChatInFullscreen"]');
      hideChatInFullscreen.checked = this.settings.hideChatInFullscreen;
      hideChatInFullscreen.addEventListener('change', () => {
        this.updateSetting('hideChatInFullscreen', hideChatInFullscreen.checked);
        this.saveSettingsNow();
      });
      panel.querySelectorAll('.yd-setting-range').forEach((input) => {
        input.addEventListener('input', () => {
          const key = input.dataset.setting;
          this.updateSetting(key, Number(input.value));
        });
        input.addEventListener('change', () => this.saveSettingsNow());
      });
      const fontSelect = panel.querySelector('[data-setting="fontFamily"]');
      fontSelect.value = this.settings.fontFamily;
      fontSelect.addEventListener('change', () => {
        this.updateSetting('fontFamily', fontSelect.value);
        this.saveSettingsNow();
      });
      const bold = panel.querySelector('[data-setting="bold"]');
      bold.checked = this.settings.bold;
      bold.addEventListener('change', () => {
        this.updateSetting('bold', bold.checked);
        this.saveSettingsNow();
      });
      this.refreshSettingsPanel(panel);
      return panel;
    }

    rangeTemplate(key, label, min, max, step, value) {
      return `<div class="yd-setting-row">
        <label for="yd-setting-${key}">${label}</label>
        <input class="yd-setting-range" id="yd-setting-${key}" data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
        <output class="yd-setting-value" data-value-for="${key}"></output>
      </div>`;
    }

    formatSettingValue(key, value) {
      if (key === 'area' || key === 'opacity') return `${Math.round(value)}%`;
      if (key === 'fontSize') return `${Math.round((value / 24) * 100)}%`;
      if (key === 'strokeWidth') return `${Number(value).toFixed(1).replace(/\.0$/, '')}px`;
      if (key === 'speed') return `${Number(value).toFixed(1)}×`;
      return String(value);
    }

    refreshSettingsPanel(panel) {
      if (!panel) return;
      const enabled = panel.querySelector('[data-setting="enabled"]');
      if (enabled) enabled.checked = this.settings.enabled;
      const hideChatInFullscreen = panel.querySelector('[data-setting="hideChatInFullscreen"]');
      if (hideChatInFullscreen) hideChatInFullscreen.checked = this.settings.hideChatInFullscreen;
      panel.querySelectorAll('.yd-setting-range').forEach((input) => {
        const key = input.dataset.setting;
        const value = Number(this.settings[key]);
        input.value = String(value);
        const percent = ((value - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
        input.style.setProperty('--yd-range-value', `${percent}%`);
        input.title = key === 'speed' ? `${value.toFixed(1)}×` : this.formatSettingValue(key, value);
        panel.querySelector(`[data-value-for="${key}"]`).textContent = this.formatSettingValue(key, value);
      });

    }

    updateSetting(key, value) {
      this.settings = normalizeSettings({ ...this.settings, [key]: value });
      this.scheduleSettingsSave();
      this.engine?.applyOptions(this.toEngineOptions());
      this.updateChatVisibility();
      this.refreshSettingsPanel(this.panel);
    }

    updateChatVisibility() {
      const wasFullscreen = this.playerWasFullscreen;
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      const isFullscreen = Boolean(
        this.player
        && (
          this.player.classList?.contains('ytp-fullscreen')
          || (
            fullscreenElement
            && (
              fullscreenElement === this.player
              || fullscreenElement.contains?.(this.player)
              || this.player.contains?.(fullscreenElement)
            )
          )
        )
      );
      this.playerWasFullscreen = isFullscreen;
      document.documentElement.classList.toggle(
        'yd-hide-chat-in-fullscreen',
        this.settings.hideChatInFullscreen && isFullscreen
      );
      if (isFullscreen) {
        clearTimeout(this.chatRefreshTimer);
        this.chatRefreshTimer = null;
        this.chatRefreshPending = false;
      }
      if (wasFullscreen && !isFullscreen && this.settings.hideChatInFullscreen) {
        this.scheduleChatReplayRefresh();
      }
    }

    scheduleChatReplayRefresh() {
      clearTimeout(this.chatRefreshTimer);
      this.chatRefreshPending = true;
      this.chatRefreshTimer = setTimeout(() => {
        this.chatRefreshTimer = null;
        this.refreshChatReplay();
      }, 500);
    }

    refreshChatReplay() {
      if (
        !this.settings.hideChatInFullscreen
        || this.playerWasFullscreen
        || !this.video
      ) {
        this.chatRefreshPending = false;
        return;
      }

      const currentTime = Number(this.video.currentTime);
      if (!Number.isFinite(currentTime)) {
        this.chatRefreshPending = false;
        return;
      }
      clearTimeout(this.chatRefreshTimer);
      this.chatRefreshTimer = null;
      this.chatRefreshPending = false;
      const duration = Number(this.video.duration);
      const offset = !Number.isFinite(duration) || currentTime + 0.001 < duration
        ? 0.001
        : -0.001;
      // YouTube rebuilds the replay iframe when fullscreen ends. A native seek event
      // repopulates the new chat without changing the user-visible playback time.
      this.video.currentTime = Math.max(0, currentTime + offset);
    }

    scheduleSettingsSave() {
      clearTimeout(this.settingsSaveTimer);
      this.settingsSaveTimer = setTimeout(() => {
        this.settingsSaveTimer = null;
        void storageSet({ ...this.settings });
      }, SETTINGS_SAVE_DELAY_MS);
    }

    saveSettingsNow() {
      clearTimeout(this.settingsSaveTimer);
      this.settingsSaveTimer = null;
      void storageSet({ ...this.settings });
    }

    toggleEnabled() {
      this.setEnabled(!this.settings.enabled);
    }

    setEnabled(enabled) {
      this.settings.enabled = Boolean(enabled);
      this.saveSettingsNow();
      this.engine?.setEnabled(this.settings.enabled);
      this.refreshSettingsPanel(this.panel);
    }

    setPanelOpen(open) {
      if (!this.panel) return;
      this.panel.hidden = !open;
      const button = this.controls?.querySelector('[data-action="settings"]');
      button?.classList.toggle('yd-is-active', open);
      button?.setAttribute('aria-expanded', String(open));
      if (open) this.positionSettingsPanel();
    }

    positionSettingsPanel() {
      const button = this.controls?.querySelector('[data-action="settings"]');
      if (!this.player || !this.panel || !button) return;

      const playerRect = this.player.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const scaleX = playerRect.width > 0 ? this.player.offsetWidth / playerRect.width : 1;
      const scaleY = playerRect.height > 0 ? this.player.offsetHeight / playerRect.height : 1;
      const right = Math.max(8, (playerRect.right - buttonRect.right) * scaleX);
      const bottom = Math.max(8, (playerRect.bottom - buttonRect.top) * scaleY + 8);

      this.panel.style.right = `${Math.round(right)}px`;
      this.panel.style.bottom = `${Math.round(bottom)}px`;
    }

    isChatFrameSource(source) {
      // MessageEvent.source is sufficient to reject messages forged by the top page.
      // Looking the source up through iframe DOM is unreliable because YouTube may
      // encapsulate or replace the live-chat frame without exposing the same node.
      return Boolean(source && source !== window);
    }

    queuePendingMessage(message, videoId) {
      this.pendingMessages.push({ message, videoId });
      if (this.pendingMessages.length > 100) this.pendingMessages.shift();
    }

    flushPendingMessages(videoId) {
      const pending = this.pendingMessages;
      this.pendingMessages = [];
      pending
        .filter((entry) => entry.videoId === videoId)
        .forEach((entry) => this.handleChatMessage(entry.message));
    }

    handleWindowMessage(event) {
      if (event.origin !== location.origin) return;
      if (!this.isChatFrameSource(event.source)) return;
      if (event.data?.source !== MESSAGE_SOURCE) return;
      if (event.data?.type === 'chat-ready') {
        const currentVideoId = getCurrentVideoId();
        if (
          this.chatRefreshPending
          && (!event.data.videoId || event.data.videoId === currentVideoId)
        ) this.refreshChatReplay();
        return;
      }

      if (event.data?.type === 'chat-message-batch') {
        if (
          !Array.isArray(event.data.payloads)
          || event.data.payloads.length > CHAT_BRIDGE_MAX_BATCH_MESSAGES
        ) return;
        this.updateChatBridgeDiagnostics(event.data.diagnostics);
        event.data.payloads.forEach((payload) => this.handleIncomingChatPayload(payload));
        return;
      }
      if (event.data?.type !== 'chat-message') return;
      this.handleIncomingChatPayload(event.data.payload);
    }

    handleIncomingChatPayload(payload) {
      if (!isValidChatMessagePayload(payload)) return;
      const currentVideoId = getCurrentVideoId();
      if (this.videoId !== currentVideoId || !this.engine) {
        const messageVideoId = payload.videoId || currentVideoId;
        if (messageVideoId === currentVideoId) {
          this.queuePendingMessage(payload, currentVideoId);
        }
        this.scheduleMount();
        return;
      }
      if (payload.videoId && payload.videoId !== currentVideoId) return;
      this.handleChatMessage(payload);
    }

    updateChatBridgeDiagnostics(value) {
      if (!value || typeof value !== 'object') return;
      const normalized = {};
      [
        'mutationCallbacks',
        'maxMutationBatchSize',
        'queuedRenderers',
        'processedRenderers',
        'parseAttempts',
        'incompleteRetries',
        'duplicateNodes',
        'invalidMessages',
        'wrapperScans',
        'slices',
        'totalParseMs',
        'maxParseMs',
        'maxSliceMs',
        'queuePeak',
        'queuedWork',
        'postedMessages',
        'postedBatches',
        'overflowed'
      ].forEach((key) => {
        const number = Number(value[key]);
        if (Number.isFinite(number) && number >= 0) normalized[key] = number;
      });
      this.bridgeDiagnostics = normalized;
      this.publishChatBridgeDiagnostics();
    }

    publishChatBridgeDiagnostics() {
      if (!this.stage || !this.bridgeDiagnostics) return;
      this.stage.dataset.bridgeDiagnostics = JSON.stringify(this.bridgeDiagnostics);
    }

    handleChatMessage(message) {
      if (!message?.id || this.seenMessages.has(message.id)) return;
      this.seenMessages.add(message.id);
      if (this.seenMessages.size > 4000) this.seenMessages.delete(this.seenMessages.values().next().value);

      const currentTime = Number(this.video?.currentTime);
      const parsedVideoTime = Number(message.videoTime);
      const hasVideoTime = message.videoTime != null
        && message.videoTime !== ''
        && Number.isFinite(parsedVideoTime);
      const timedMessage = {
        ...message,
        videoTime: hasVideoTime
          ? parsedVideoTime
          : Number.isFinite(currentTime) ? currentTime : 0
      };
      this.timelineMessages.push(timedMessage);
      if (this.timelineMessages.length > 4000) this.timelineMessages.shift();
      if (
        hasVideoTime
        && Number.isFinite(currentTime)
        && parsedVideoTime < currentTime - CHAT_REPLAY_LATE_TOLERANCE_SECONDS
      ) return;
      if (typeof this.engine?.enqueueDeferred === 'function') {
        this.engine.enqueueDeferred(timedMessage);
      } else {
        this.engine?.enqueue(timedMessage);
      }
    }

    rebuildDanmakuTimeline() {
      const currentTime = Number(this.video?.currentTime);
      if (!Number.isFinite(currentTime)) return;
      this.engine?.rebuildAtTime(this.timelineMessages, currentTime);
    }

    recordMediaTimeObservation(observedAt = performance.now()) {
      const currentTime = Number(this.video?.currentTime);
      this.lastObservedMediaTime = Number.isFinite(currentTime) ? currentTime : null;
      this.lastObservedMediaAt = Number.isFinite(Number(observedAt)) ? Number(observedAt) : null;
    }

    handleMediaTimeUpdate(observedAt = performance.now()) {
      const currentTime = Number(this.video?.currentTime);
      const wallTime = Number(observedAt);
      if (!Number.isFinite(currentTime) || !Number.isFinite(wallTime)) return false;

      let discontinuity = false;
      if (
        Number.isFinite(this.lastObservedMediaTime)
        && Number.isFinite(this.lastObservedMediaAt)
      ) {
        const mediaDelta = currentTime - this.lastObservedMediaTime;
        const wallDelta = Math.max(0, (wallTime - this.lastObservedMediaAt) / 1000);
        const playbackRate = Math.max(0.01, Number(this.video?.playbackRate) || 1);
        const expectedAdvance = wallDelta * playbackRate;
        discontinuity = mediaDelta < -0.5 || mediaDelta > expectedAdvance + 1.5;
      }

      this.lastObservedMediaTime = currentTime;
      this.lastObservedMediaAt = wallTime;
      if (discontinuity) this.rebuildDanmakuTimeline();
      return discontinuity;
    }

    unmountPlayer() {
      this.abortController?.abort();
      this.abortController = null;
      clearTimeout(this.chatRefreshTimer);
      this.chatRefreshTimer = null;
      this.chatRefreshPending = false;
      this.fullscreenObserver?.disconnect();
      this.fullscreenObserver = null;
      this.playerWasFullscreen = false;
      document.documentElement.classList.remove('yd-hide-chat-in-fullscreen');
      this.engine?.destroy();
      this.engine = null;
      this.controls?.remove();
      this.stage?.remove();
      this.panel?.remove();
      this.controls = null;
      this.stage = null;
      this.panel = null;
      this.player = null;
      this.video = null;
      this.videoId = '';
      this.lastObservedMediaTime = null;
      this.lastObservedMediaAt = null;
      this.seenMessages.clear();
      this.timelineMessages = [];
    }
  }

  globalThis.YTDanmakuExtension = {
    ChatFrameBridge,
    DEFAULT_SETTINGS,
    YouTubeDanmakuApp,
    detectAuthorRole,
    extractMessageSegments,
    extractText,
    getVideoIdFromUrl,
    isValidChatMessagePayload,
    normalizeSettings,
    parseChatReplayTimestamp
  };

  if (window.top !== window) {
    if (/^\/live_chat(?:_replay)?/.test(location.pathname)) new ChatFrameBridge().start();
    return;
  }

  if (location.hostname === 'www.youtube.com') new YouTubeDanmakuApp().start();
})();
