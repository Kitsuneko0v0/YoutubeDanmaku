'use strict';

const assert = require('node:assert/strict');
const {
  createTranslator,
  getBrowserLocale,
  normalizeLocale
} = require('../src/i18n.js');

assert.equal(normalizeLocale('zh-CN'), 'zh');
assert.equal(normalizeLocale('zh-TW'), 'zh');
assert.equal(normalizeLocale('ja-JP'), 'ja');
assert.equal(normalizeLocale('ko-KR'), 'ko');
assert.equal(normalizeLocale('en-US'), 'en');
assert.equal(normalizeLocale('fr-FR'), 'en', '未支持的语言应回退到英文');

assert.equal(createTranslator('zh-CN')('settingsTitle'), '弹幕设置');
assert.equal(createTranslator('ja-JP')('settingsTitle'), '弾幕設定');
assert.equal(createTranslator('ko-KR')('settingsTitle'), '탄막 설정');
assert.equal(createTranslator('en-US')('settingsTitle'), 'Danmaku settings');
assert.equal(createTranslator('zh-CN')('hideChatInFullscreen'), '全屏时隐藏评论栏');
assert.equal(
  createTranslator('fr-FR')('enableDanmaku'),
  'Enable danmaku',
  '未支持的语言应使用英文 UI 文本'
);

assert.equal(
  getBrowserLocale({
    chrome: { i18n: { getUILanguage: () => 'ja-JP' } },
    navigator: { language: 'zh-CN' }
  }),
  'ja',
  '扩展环境应优先使用浏览器 UI 语言'
);
assert.equal(
  getBrowserLocale({
    chrome: { i18n: { getUILanguage: () => 'fr-FR' } },
    navigator: { language: 'zh-CN' }
  }),
  'en',
  '浏览器 UI 语言未命中时应直接回退英文'
);
assert.equal(
  getBrowserLocale({
    navigator: { languages: ['ko-KR', 'en-US'] }
  }),
  'ko',
  '无扩展 API 时应使用浏览器首选语言'
);
assert.equal(
  typeof createTranslator()('settingsTitle'),
  'string',
  '默认翻译器应能直接读取当前运行环境的浏览器语言'
);

console.log('i18n tests passed');
