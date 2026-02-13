const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const { inferTitleType } = require('./title-policy');

const patternLog = createLogger('pattern');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const HISTORY_PATH = path.join(DATA_DIR, 'pattern-history.jsonl');

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const normalizeText = (text = '') =>
  String(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toSectionKey = (h2 = '') => {
  const t = normalizeText(h2).toLowerCase();
  if (!t) return 'section';

  if (/비교|테이블|표/.test(t)) return 'compare_table';
  if (/plus/.test(t) && /특징|핵심/.test(t)) return 'plus_features';
  if (/pro/.test(t) && /특징|핵심/.test(t)) return 'pro_features';
  if (/가이드|선택|추천/.test(t)) return 'decision_guide';
  if (/faq|자주 묻는|질문/.test(t)) return 'faq';
  if (/주의|리스크/.test(t)) return 'risk_notice';
  if (/요약|핵심/.test(t)) return 'summary_insight';
  if (/문제|배경/.test(t)) return 'problem_context';

  return t
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .replace(/\s+/g, '_')
    .slice(0, 30) || 'section';
};

const summarizeContentStructure = (content = '', fallbackTopic = '') => {
  const h2Matches = [...String(content).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((m) => normalizeText(m[1]))
    .filter(Boolean);

  const sectionKeys = h2Matches.map((h) => toSectionKey(h)).slice(0, 6);
  const hasTable = /<table\b/i.test(content);
  const hasFaq = sectionKeys.includes('faq') || /faq|자주 묻는 질문/i.test(content);

  let structureType = 'general_a';
  const topic = String(fallbackTopic).toLowerCase();
  if (/\bvs\b|비교|차이|plus|pro/.test(topic) || sectionKeys.includes('compare_table')) {
    structureType = 'compare_a';
  }

  return {
    sectionKeys: sectionKeys.length ? sectionKeys : ['section'],
    h2Count: h2Matches.length,
    hasTable,
    hasFaq,
    structureType,
  };
};

const appendPatternRecord = (record) => {
  ensureDataDir();
  fs.appendFileSync(HISTORY_PATH, `${JSON.stringify(record)}\n`);
};

const readRecentPatterns = ({ category = null, limit = 5 } = {}) => {
  if (!fs.existsSync(HISTORY_PATH)) return [];

  const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const records = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (category && parsed.category !== category) continue;
      records.push(parsed);
      if (records.length >= limit) break;
    } catch {
      // ignore broken line
    }
  }

  return records;
};

const recordPublishedPattern = ({
  title,
  topic,
  content,
  url,
  postId,
  category,
  generationMeta,
}) => {
  try {
    const fallback = summarizeContentStructure(content || '', topic || '');
    const structureType = generationMeta?.structureType || fallback.structureType;
    const sectionKeys = generationMeta?.sectionKeys || fallback.sectionKeys;

    const record = {
      ts: new Date().toISOString(),
      postId: postId || null,
      url: url || null,
      title: title || '',
      titleType: inferTitleType(title || ''),
      topic: topic || '',
      structureType,
      sectionKeys,
      h2Count: fallback.h2Count,
      hasTable: fallback.hasTable,
      hasFaq: fallback.hasFaq,
      category: category || 'unknown',
    };

    appendPatternRecord(record);
    patternLog.info('발행 패턴 기록 완료', {
      title: record.title,
      titleType: record.titleType,
      structureType: record.structureType,
      category: record.category,
    });
  } catch (e) {
    patternLog.warn('발행 패턴 기록 실패', { error: e.message });
  }
};

module.exports = {
  HISTORY_PATH,
  summarizeContentStructure,
  appendPatternRecord,
  readRecentPatterns,
  recordPublishedPattern,
};
