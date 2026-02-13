const TITLE_TYPES = ['numeric', 'question', 'contrast', 'statement'];

const inferTitleType = (title = '') => {
  const text = String(title).trim();
  const lower = text.toLowerCase();

  if (/\d+\s*(가지|개|단계|포인트|핵심)|^\d+/.test(text)) return 'numeric';
  if (/\?|무엇|어떻게|왜|할까|인가/.test(text)) return 'question';
  if (/\bvs\b|대\s|비교|차이/.test(lower)) return 'contrast';
  return 'statement';
};

const computeTitleStats = (records = []) => {
  const counts = {
    numeric: 0,
    question: 0,
    contrast: 0,
    statement: 0,
  };

  for (const record of records) {
    const type = record?.titleType || inferTitleType(record?.title || '');
    if (counts[type] == null) continue;
    counts[type] += 1;
  }

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { counts, total };
};

const pickAllowedTitleTypes = (records = [], numericCap = 0.4) => {
  const stats = computeTitleStats(records);
  const numericRatio = stats.total ? stats.counts.numeric / stats.total : 0;

  const allowed = numericRatio >= numericCap
    ? TITLE_TYPES.filter((t) => t !== 'numeric')
    : [...TITLE_TYPES];

  return {
    allowed,
    numericRatio,
    counts: stats.counts,
    total: stats.total,
  };
};

const isAllowedTitle = (title, allowedTypes = TITLE_TYPES) => {
  const type = inferTitleType(title);
  return { ok: allowedTypes.includes(type), type };
};

module.exports = {
  TITLE_TYPES,
  inferTitleType,
  computeTitleStats,
  pickAllowedTitleTypes,
  isAllowedTitle,
};
