const fs = require('fs');

const BLOG_NAME = 'tkman';
const BASE = `https://${BLOG_NAME}.tistory.com/manage`;

const loadCookies = () => {
  const session = JSON.parse(fs.readFileSync('./session.json', 'utf-8'));
  return session.cookies
    .filter(c => c.domain.includes('tistory'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
};

const getHeaders = () => ({
  'Cookie': loadCookies(),
  'Content-Type': 'application/json;charset=UTF-8',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Referer': `${BASE}/newpost`,
  'X-Requested-With': 'XMLHttpRequest',
});

/**
 * 글 발행
 * @param {Object} options
 * @param {string} options.title - 제목
 * @param {string} options.content - HTML 본문
 * @param {number} [options.visibility=0] - 0: 비공개, 3: 공개
 * @param {number} [options.category=0] - 카테고리 ID
 * @param {string} [options.tag=''] - 태그 (쉼표 구분)
 * @returns {Promise<{entryUrl: string}>}
 */
const publishPost = async ({ title, content, visibility = 0, category = 0, tag = '' }) => {
  const res = await fetch(`${BASE}/post.json`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ title, content, visibility, category, tag }),
  });

  if (!res.ok) throw new Error(`발행 실패: ${res.status}`);
  const data = await res.json();
  console.log(`발행 완료: ${data.entryUrl}`);
  return data;
};

/**
 * 임시저장
 */
const saveDraft = async ({ title, content }) => {
  const res = await fetch(`${BASE}/drafts`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ title, content }),
  });

  if (!res.ok) throw new Error(`임시저장 실패: ${res.status}`);
  const data = await res.json();
  console.log(`임시저장 완료 (sequence: ${data.draft.sequence})`);
  return data;
};

/**
 * 글 목록 조회
 */
const getPosts = async () => {
  const res = await fetch(`${BASE}/posts.json`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`목록 조회 실패: ${res.status}`);
  return res.json();
};

/**
 * 카테고리 목록 (하드코딩 대신 페이지에서 가져옴)
 */
const CATEGORIES = {
  'Web': 1266855,
  'Web/Frontend': 1234624,
  'Web/Backend': 1234625,
  'Web/DevOps': 1234626,
  'AI': 1283219,
  'Reversing': 1266856,
  '기타': 1247460,
  'Viruagent': 1283708,
  'Viruagent/Heartbeat': 1283709,
  'Viruagent/Dev Log': 1283710,
};

module.exports = { publishPost, saveDraft, getPosts, CATEGORIES };

// CLI 모드
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'publish') {
    publishPost({
      title: args[1] || '테스트 글',
      content: args[2] || '<p>자동 작성된 글입니다.</p>',
      visibility: Number(args[3]) || 0,
      category: Number(args[4]) || 0,
      tag: args[5] || '',
    });
  } else if (cmd === 'draft') {
    saveDraft({
      title: args[1] || '임시저장 테스트',
      content: args[2] || '<p>임시저장 내용</p>',
    });
  } else if (cmd === 'list') {
    getPosts().then(d => {
      console.log(`총 ${d.totalCount}개 글`);
      d.items?.forEach(p => console.log(`  [${p.id}] ${p.title} (${p.visibility})`));
    });
  } else {
    console.log(`사용법:
  node tistory.js publish "제목" "<p>내용</p>" [visibility] [categoryId] [tags]
  node tistory.js draft "제목" "<p>내용</p>"
  node tistory.js list

visibility: 0=비공개, 3=공개
카테고리: ${JSON.stringify(CATEGORIES, null, 2)}`);
  }
}
