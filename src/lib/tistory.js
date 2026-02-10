const fs = require('fs');
const path = require('path');

let blogName = null;
let blogInfo = null;

const loadCookies = () => {
  const session = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'session.json'), 'utf-8'));
  return session.cookies
    .filter(c => c.domain.includes('tistory'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
};

const getBase = () => {
  if (!blogName) throw new Error('블로그 이름이 초기화되지 않았습니다. initBlog()를 먼저 호출하세요.');
  return `https://${blogName}.tistory.com/manage`;
};

const getHeaders = () => ({
  'Cookie': loadCookies(),
  'Content-Type': 'application/json;charset=UTF-8',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Referer': `${getBase()}/newpost`,
  'X-Requested-With': 'XMLHttpRequest',
});

/**
 * 로그인 세션에서 블로그 정보를 자동 감지
 * @returns {Promise<string>} 블로그 이름
 */
const initBlog = async () => {
  if (blogName) return blogName;

  const res = await fetch('https://www.tistory.com/legacy/member/blog/api/myBlogs', {
    headers: {
      'Cookie': loadCookies(),
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  if (!res.ok) throw new Error(`블로그 정보 조회 실패: ${res.status}`);
  const json = await res.json();

  const defaultBlog = json.data?.find(b => b.defaultBlog) || json.data?.[0];
  if (!defaultBlog) throw new Error('블로그를 찾을 수 없습니다.');

  blogName = defaultBlog.name;
  blogInfo = defaultBlog;
  return blogName;
};

const getBlogName = () => blogName;
const getBlogInfo = () => blogInfo;

// visibility: 0=비공개, 15=보호, 20=공개
const VISIBILITY = { PRIVATE: 0, PROTECTED: 15, PUBLIC: 20 };

/**
 * 글 발행
 * @param {Object} options
 * @param {string} options.title - 제목
 * @param {string} options.content - HTML 본문
 * @param {number} [options.visibility=20] - 0: 비공개, 15: 보호, 20: 공개
 * @param {number} [options.category=0] - 카테고리 ID
 * @param {string} [options.tag=''] - 태그 (쉼표 구분)
 * @returns {Promise<Object>}
 */
const publishPost = async ({ title, content, visibility = VISIBILITY.PUBLIC, category = 0, tag = '' }) => {
  const res = await fetch(`${getBase()}/post.json`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      id: '0',
      title,
      content,
      visibility,
      category,
      tag,
      published: 1,
      type: 'post',
      uselessMarginForEntry: 1,
      cclCommercial: 0,
      cclDerive: 0,
      attachments: [],
      recaptchaValue: '',
      draftSequence: null,
    }),
  });

  if (!res.ok) throw new Error(`발행 실패: ${res.status}`);
  const data = await res.json();
  return data;
};

/**
 * 임시저장
 */
const saveDraft = async ({ title, content }) => {
  const res = await fetch(`${getBase()}/drafts`, {
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
  const res = await fetch(`${getBase()}/posts.json`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`목록 조회 실패: ${res.status}`);
  return res.json();
};

/**
 * 카테고리 목록을 글쓰기 페이지에서 동적으로 가져옴
 * @returns {Promise<Record<string, number>>} { "카테고리명": id }
 */
const getCategories = async () => {
  const res = await fetch(`${getBase()}/newpost`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`카테고리 조회 실패: ${res.status}`);
  const html = await res.text();

  // window.Config의 blog.categories를 vm으로 안전하게 추출
  const vm = require('vm');
  const configMatch = html.match(/window\.Config\s*=\s*(\{[\s\S]*?\})\s*\n/);
  if (!configMatch) throw new Error('카테고리 파싱 실패');

  const sandbox = {};
  vm.runInNewContext(`var result = ${configMatch[1]}`, sandbox);
  const catList = sandbox.result.blog.categories;
  const categories = {};

  const flatten = (list) => {
    for (const cat of list) {
      categories[cat.label] = cat.id;
      if (cat.children?.length) flatten(cat.children);
    }
  };
  flatten(catList);

  return categories;
};

module.exports = { initBlog, getBlogName, getBlogInfo, publishPost, saveDraft, getPosts, getCategories, VISIBILITY };

// CLI 모드
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  initBlog().then(() => {

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
  } else if (cmd === 'categories') {
    getCategories().then(cats => {
      console.log('카테고리 목록:');
      Object.entries(cats).forEach(([name, id]) => console.log(`  ${id} → ${name}`));
    });
  } else {
    console.log(`사용법:
  node tistory.js publish "제목" "<p>내용</p>" [visibility] [categoryId] [tags]
  node tistory.js draft "제목" "<p>내용</p>"
  node tistory.js list
  node tistory.js categories

visibility: 0=비공개, 3=공개`);
  }

  }).catch(e => console.error(`초기화 실패: ${e.message}`));
}
