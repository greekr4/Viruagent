const normalize = (text = '') => String(text).toLowerCase().replace(/\s+/g, ' ').trim();

const isCompareTopic = (topic = '') => {
  const t = normalize(topic);
  return /(\bvs\b|비교|차이|플랜|요금제|plus|pro|review|리뷰)/.test(t);
};

const COMPARE_TEMPLATES = [
  {
    id: 'compare_a',
    sectionKeys: ['compare_table', 'core_diff', 'use_case', 'decision_guide'],
    instruction:
      '- 섹션 순서: 한눈에 비교표 → 핵심 차이 3가지 → 사용자 시나리오별 추천 → 최종 선택 가이드\n' +
      '- 비교표는 초반에 1회만 배치하고, 이후는 사례 중심으로 전개',
  },
  {
    id: 'compare_b',
    sectionKeys: ['summary_insight', 'compare_table', 'cost_tradeoff', 'checklist'],
    instruction:
      '- 섹션 순서: 요약 인사이트 → 비교표 → 비용/성능 트레이드오프 → 선택 체크리스트\n' +
      '- 초반 요약 인사이트로 결론 방향을 먼저 제시',
  },
  {
    id: 'compare_c',
    sectionKeys: ['compare_table', 'workflow_example', 'risk_notice', 'decision_guide'],
    instruction:
      '- 섹션 순서: 비교표 → 실제 활용 워크플로 예시 2개 → 리스크/주의점 → 선택 가이드\n' +
      '- 기능 나열보다 실제 사용 흐름 설명 비중을 높임',
  },
  {
    id: 'compare_d',
    sectionKeys: ['problem_context', 'compare_table', 'faq', 'next_action'],
    instruction:
      '- 섹션 순서: 문제 맥락 정의 → 비교표 → FAQ 3문항 → 다음 액션\n' +
      '- FAQ 섹션을 반드시 포함해서 반복 질문을 정리',
  },
];

const DEFAULT_TEMPLATE = {
  id: 'general_a',
  sectionKeys: ['intro', 'main_point', 'detail', 'action'],
  instruction:
    '- 섹션 순서: 문제 정의 → 핵심 포인트 → 상세 사례 → 실행 액션\n' +
    '- 동일 레이블 반복을 피하고 섹션 역할을 분명히 분리',
};

const collisionScore = (template, recentPatterns) => {
  let score = 0;

  for (const item of recentPatterns) {
    if (!item) continue;

    if (item.structureType === template.id) score += 3;

    const recentKeys = Array.isArray(item.sectionKeys) ? item.sectionKeys : [];
    const recentHead = recentKeys.slice(0, 3).join('|');
    const currentHead = template.sectionKeys.slice(0, 3).join('|');
    if (recentHead && recentHead === currentHead) score += 2;

    if (recentKeys[0] && recentKeys[0] === template.sectionKeys[0]) score += 1;
  }

  return score;
};

const pickStructureTemplate = ({ topic, recentPatterns = [] }) => {
  const templates = isCompareTopic(topic) ? COMPARE_TEMPLATES : [DEFAULT_TEMPLATE];

  let best = templates[0];
  let bestScore = collisionScore(best, recentPatterns);

  for (let i = 1; i < templates.length; i++) {
    const candidate = templates[i];
    const score = collisionScore(candidate, recentPatterns);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return {
    ...best,
    collisionScore: bestScore,
  };
};

const summarizeRecentPatterns = (records = []) => {
  if (!records.length) return '최근 발행 패턴 데이터 없음';

  return records
    .slice(0, 5)
    .map((r, idx) => {
      const title = (r.title || '').slice(0, 60);
      const sectionHead = Array.isArray(r.sectionKeys) ? r.sectionKeys.slice(0, 3).join(' > ') : 'none';
      return `${idx + 1}) [${r.titleType || 'unknown'}] ${title} | ${r.structureType || 'unknown'} | ${sectionHead}`;
    })
    .join('\n');
};

module.exports = {
  isCompareTopic,
  pickStructureTemplate,
  summarizeRecentPatterns,
};
