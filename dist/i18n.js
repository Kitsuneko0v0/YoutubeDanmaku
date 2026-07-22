(function bootstrapYouTubeDanmakuI18n(root, factory) {
  const api = factory(root);
  root.YTDanmakuI18n = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createYouTubeDanmakuI18n(root) {
  'use strict';

  const DEFAULT_LOCALE = 'en';
  const TRANSLATIONS = Object.freeze({
    en: Object.freeze({
      settingsButton: 'Danmaku settings',
      settingsTitle: 'Danmaku settings',
      closeSettings: 'Close danmaku settings',
      enableDanmaku: 'Enable danmaku',
      hideChatInFullscreen: 'Hide chat in fullscreen',
      displayArea: 'Display area',
      opacity: 'Opacity',
      fontSize: 'Font size',
      speed: 'Danmaku speed',
      fontFamily: 'Font',
      defaultFont: 'Default',
      systemCjkFont: 'Microsoft YaHei / PingFang',
      bold: 'Bold',
      strokeWidth: 'Outline width'
    }),
    zh: Object.freeze({
      settingsButton: '弹幕设置',
      settingsTitle: '弹幕设置',
      closeSettings: '关闭弹幕设置',
      enableDanmaku: '启用弹幕',
      hideChatInFullscreen: '全屏时隐藏评论栏',
      displayArea: '显示区域',
      opacity: '不透明度',
      fontSize: '弹幕字号',
      speed: '弹幕速度',
      fontFamily: '弹幕字体',
      defaultFont: '默认',
      systemCjkFont: '微软雅黑 / 苹方',
      bold: '粗体',
      strokeWidth: '描边粗细'
    }),
    ja: Object.freeze({
      settingsButton: '弾幕設定',
      settingsTitle: '弾幕設定',
      closeSettings: '弾幕設定を閉じる',
      enableDanmaku: '弾幕を有効にする',
      hideChatInFullscreen: '全画面時にチャットを隠す',
      displayArea: '表示範囲',
      opacity: '不透明度',
      fontSize: '文字サイズ',
      speed: '弾幕速度',
      fontFamily: 'フォント',
      defaultFont: 'デフォルト',
      systemCjkFont: 'Microsoft YaHei / PingFang',
      bold: '太字',
      strokeWidth: '縁取り幅'
    }),
    ko: Object.freeze({
      settingsButton: '탄막 설정',
      settingsTitle: '탄막 설정',
      closeSettings: '탄막 설정 닫기',
      enableDanmaku: '탄막 사용',
      hideChatInFullscreen: '전체 화면에서 채팅 숨기기',
      displayArea: '표시 영역',
      opacity: '불투명도',
      fontSize: '글자 크기',
      speed: '탄막 속도',
      fontFamily: '글꼴',
      defaultFont: '기본값',
      systemCjkFont: 'Microsoft YaHei / PingFang',
      bold: '굵게',
      strokeWidth: '외곽선 두께'
    })
  });

  function normalizeLocale(language) {
    const tag = String(language || '').trim().toLowerCase().replace(/_/g, '-');
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh';
    if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
    if (tag === 'ko' || tag.startsWith('ko-')) return 'ko';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
    return DEFAULT_LOCALE;
  }

  function getBrowserLocale(environment) {
    const runtime = environment || root;
    let browserLanguage = '';

    try {
      browserLanguage = runtime.chrome?.i18n?.getUILanguage?.() || '';
    } catch (_) {
      browserLanguage = '';
    }

    if (browserLanguage) return normalizeLocale(browserLanguage);

    const navigatorLanguage = runtime.navigator?.languages?.[0]
      || runtime.navigator?.language
      || '';
    return normalizeLocale(navigatorLanguage);
  }

  function createTranslator(language) {
    const locale = language ? normalizeLocale(language) : getBrowserLocale();
    const translate = (key) => (
      TRANSLATIONS[locale]?.[key]
      || TRANSLATIONS[DEFAULT_LOCALE][key]
      || key
    );
    translate.locale = locale;
    return translate;
  }

  return {
    DEFAULT_LOCALE,
    TRANSLATIONS,
    createTranslator,
    getBrowserLocale,
    normalizeLocale
  };
});
