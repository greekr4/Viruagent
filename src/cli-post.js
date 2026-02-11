#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { generatePost, loadConfig } = require('./lib/ai');
const { initBlog, publishPost, saveDraft, getCategories, VISIBILITY } = require('./lib/tistory');

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') { args.dryRun = true; continue; }
    if (arg === '--draft') { args.draft = true; continue; }
    if (arg === '--list-categories') { args.listCategories = true; continue; }
    if (arg.startsWith('--') && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[++i];
    }
  }
  return args;
};

const visibilityMap = {
  public: VISIBILITY.PUBLIC,
  private: VISIBILITY.PRIVATE,
  protected: VISIBILITY.PROTECTED,
};

const output = (obj) => {
  console.log(JSON.stringify(obj));
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  await initBlog();

  // 카테고리 목록 조회
  if (args.listCategories) {
    const cats = await getCategories();
    output({ success: true, categories: Object.entries(cats).map(([name, id]) => ({ name, id })) });
    return;
  }

  // topic 필수
  if (!args.topic) {
    output({ success: false, error: '--topic은 필수입니다.' });
    process.exit(1);
  }

  const config = loadConfig();

  // 글 생성
  const post = await generatePost(args.topic, {
    model: args.model || config.defaultModel,
    tone: args.tone || config.defaultTone,
  });

  // dry-run: 생성만
  if (args.dryRun) {
    output({ success: true, title: post.title, tags: post.tags, preview: post.content.slice(0, 200) });
    return;
  }

  const visibility = visibilityMap[args.visibility] ?? VISIBILITY.PUBLIC;
  const category = Number(args.category) || 0;

  // 임시저장
  if (args.draft) {
    const result = await saveDraft({ title: post.title, content: post.content });
    output({ success: true, mode: 'draft', title: post.title, tags: post.tags, sequence: result.draft?.sequence });
    return;
  }

  // 발행
  const result = await publishPost({
    title: post.title,
    content: post.content,
    visibility,
    category,
    tag: post.tags,
    thumbnail: post.thumbnailKage || null,
  });

  const url = result.entryUrl || null;

  output({ success: true, mode: 'publish', title: post.title, tags: post.tags, url });
};

main().catch((e) => {
  output({ success: false, error: e.message });
  process.exit(1);
});
