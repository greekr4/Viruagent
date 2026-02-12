const readline = require('readline');
const chalk = require('chalk');
const { generatePost, revisePost, chat, runAgent, MODELS, loadConfig } = require('./lib/ai');
const { initBlog, getBlogName, publishPost, saveDraft, getPosts, getCategories, VISIBILITY } = require('./lib/tistory');

const TONES = loadConfig().tones.map((t) => t.name);

/**
 * 화살표 키로 항목을 선택하는 인터랙티브 메뉴
 * @param {string[]} items - 선택지 목록
 * @param {string} [title='선택하세요'] - 상단 제목
 * @returns {Promise<number>} 선택된 인덱스 (-1이면 취소)
 */
const selectMenu = (items, title = '선택하세요') =>
  new Promise((resolve) => {
    let cursor = 0;

    const render = () => {
      // 이전 출력 지우기
      process.stdout.write(`\x1B[${items.length + 1}A\x1B[J`);
      draw();
    };

    const draw = () => {
      console.log(chalk.bold(title));
      items.forEach((item, i) => {
        const prefix = i === cursor ? chalk.green('❯ ') : '  ';
        const text = i === cursor ? chalk.green.bold(item) : chalk.dim(item);
        console.log(`${prefix}${text}`);
      });
    };

    draw();

    const onKeypress = (_, key) => {
      if (!key) return;

      if (key.name === 'up') {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
      } else if (key.name === 'down') {
        cursor = (cursor + 1) % items.length;
        render();
      } else if (key.name === 'return') {
        cleanup();
        resolve(cursor);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        resolve(-1);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY && !process.stdin.isRaw) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKeypress);
  });

// 설정 저장/로드
const fs = require('fs');
const path = require('path');
const os = require('os');
const CONFIG_DIR = path.join(os.homedir(), '.viruagent');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = { category: 0, visibility: 20, model: 'gpt-4o-mini', tone: loadConfig().defaultTone };

const visLabel = (v) => (v === 20 ? '공개 발행' : v === 15 ? '보호 발행' : '비공개 발행');

const ensureConfigDir = () => {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
};

const loadSettings = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) };
  } catch {
    return { ...DEFAULTS };
  }
};

const saveSettings = () => {
  ensureConfigDir();
  const current = loadSettings();
  const { category, visibility, model, tone } = state;
  const merged = { ...current, category, visibility, model, tone };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
};

const saved = loadSettings();

// 상태
const state = {
  draft: null, // { title, content, tags }
  categories: {}, // { name: id }
  category: saved.category,
  visibility: saved.visibility,
  model: saved.model,
  tone: saved.tone,
  chatHistory: [],
};

const log = {
  info: (msg) => console.log(chalk.cyan(`ℹ ${msg}`)),
  success: (msg) => console.log(chalk.green(`✓ ${msg}`)),
  error: (msg) => console.log(chalk.red(`✗ ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`⚠ ${msg}`)),
  title: (msg) => console.log(chalk.bold.magenta(msg)),
  dim: (msg) => console.log(chalk.dim(msg)),
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const animateBanner = async () => {
  const figlet = require('figlet');
  const gradient = require('gradient-string');

  const text = figlet.textSync('ViruAgent', { font: 'ANSI Shadow' });
  const lines = text.split('\n');
  const totalLines = lines.length;
  const { version } = require('../package.json');
  const sub = `  대화형 티스토리 블로그 에이전트  v${version}`;

  console.log();

  // 라인별 드롭 애니메이션
  for (let i = 0; i < totalLines; i++) {
    console.log(gradient.pastel(lines[i]));
    await sleep(40);
  }

  // 서브타이틀
  await sleep(100);
  const cols = process.stdout.columns || 80;
  const pad = Math.max(0, Math.floor((cols - sub.length) / 2));
  console.log(' '.repeat(pad) + chalk.dim(sub));
  console.log();
};

const showBootStep = async (msg, asyncFn, minMs = 800) => {
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r  ${chalk.cyan(SPINNER_FRAMES[i++ % SPINNER_FRAMES.length])} ${chalk.dim(msg)}`);
  }, 80);
  try {
    const [result] = await Promise.all([asyncFn(), sleep(minMs)]);
    clearInterval(timer);
    process.stdout.write(`\r  ${chalk.green('✓')} ${msg}\n`);
    return result;
  } catch (e) {
    clearInterval(timer);
    process.stdout.write(`\r  ${chalk.red('✗')} ${msg}\n`);
    throw e;
  }
};

const withSpinner = async (message, asyncFn) => {
  let i = 0;
  const cols = process.stdout.columns || 80;
  const truncated = message.length + 2 > cols ? message.slice(0, cols - 5) + '...' : message;
  const timer = setInterval(() => {
    process.stdout.write(`\r\x1B[K${chalk.cyan(SPINNER_FRAMES[i++ % SPINNER_FRAMES.length])} ${truncated}`);
  }, 80);
  try {
    return await asyncFn();
  } finally {
    clearInterval(timer);
    process.stdout.write('\r\x1B[K');
  }
};

const COMMANDS = [
  '/write',
  '/edit',
  '/preview',
  '/publish',
  '/draft',
  '/list',
  '/categories',
  '/set',
  '/login',
  '/logout',
  '/help',
  '/exit',
];
const SET_KEYS = ['category', 'visibility', 'model', 'tone', 'api'];

const completer = (line) => {
  // /set model <값> 자동완성
  if (line.match(/^\/set\s+model\s+/)) {
    const partial = line.split(/\s+/).pop();
    const hits = MODELS.filter((m) => m.startsWith(partial));
    return [hits.length ? hits : MODELS, partial];
  }

  // /set visibility <값> 자동완성
  if (line.match(/^\/set\s+visibility\s+/)) {
    const opts = ['공개', '보호', '비공개'];
    const partial = line.split(/\s+/).pop();
    const hits = opts.filter((v) => v.startsWith(partial));
    return [hits.length ? hits : opts, partial];
  }

  // /set tone <값> 자동완성
  if (line.match(/^\/set\s+tone\s+/)) {
    const partial = line.split(/\s+/).pop();
    const hits = TONES.filter((t) => t.startsWith(partial));
    return [hits.length ? hits : TONES, partial];
  }

  // /set category <이름> 자동완성
  if (line.match(/^\/set\s+category\s+/)) {
    const partial = line.replace(/^\/set\s+category\s+/, '');
    const names = Object.keys(state.categories);
    const hits = names.filter((n) => n.startsWith(partial));
    return [hits.length ? hits : names, partial];
  }

  // /set <키> 자동완성
  if (line.match(/^\/set\s+/)) {
    const partial = line.split(/\s+/).pop();
    const hits = SET_KEYS.filter((k) => k.startsWith(partial));
    return [hits.length ? hits : SET_KEYS, partial];
  }

  // / 커맨드 자동완성
  if (line.startsWith('/')) {
    const hits = COMMANDS.filter((c) => c.startsWith(line.split(/\s+/)[0]));
    return [hits.length ? hits : COMMANDS, line.split(/\s+/)[0]];
  }

  return [[], line];
};

const COMMAND_HINTS = {
  '/write': '/write <주제>',
  '/edit': '/edit <수정 지시>',
  '/preview': '/preview',
  '/publish': '/publish',
  '/draft': '/draft',
  '/list': '/list',
  '/categories': '/categories',
  '/set': '/set <category|visibility|model|tone|api>',
  '/login': '/login',
  '/logout': '/logout',
  '/help': '/help',
  '/exit': '/exit',
};

const getHint = (line) => {
  if (!line || !line.startsWith('/')) return '';

  const parts = line.split(/\s+/);
  const cmd = parts[0];

  // /set 서브커맨드 힌트
  if (cmd === '/set' && parts.length >= 2) {
    const subKey = parts[1];
    if (parts.length === 2) {
      // /set 이후 키 입력 중
      const match = SET_KEYS.find((k) => k.startsWith(subKey) && k !== subKey);
      if (match) return match.slice(subKey.length);
    }
    if (parts.length === 3 && subKey === 'model') {
      const partial = parts[2];
      const match = MODELS.find((m) => m.startsWith(partial) && m !== partial);
      if (match) return match.slice(partial.length);
    }
    if (parts.length === 3 && subKey === 'tone') {
      const partial = parts[2];
      const match = TONES.find((t) => t.startsWith(partial) && t !== partial);
      if (match) return match.slice(partial.length);
    }
    return '';
  }

  // 정확히 매칭되는 커맨드가 있으면 전체 힌트
  if (COMMAND_HINTS[cmd] && cmd === line) {
    const hint = COMMAND_HINTS[cmd];
    return hint.slice(line.length);
  }

  // 부분 입력이면 첫 번째 매칭 커맨드 추천
  const match = COMMANDS.find((c) => c.startsWith(cmd) && c !== cmd);
  if (match) {
    const hint = COMMAND_HINTS[match] || match;
    return hint.slice(line.length);
  }

  return '';
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer,
});

// 키 입력마다 ghost hint 표시
process.stdin.on('keypress', () => {
  // nextTick으로 rl.line이 업데이트된 후 실행
  process.nextTick(() => {
    const line = rl.line;
    const hint = getHint(line);

    // 현재 커서 위치 저장 → 잔상 지우기 → 힌트 출력 → 커서 복원
    process.stdout.write(`\x1B[s\x1B[K${hint ? chalk.dim(hint) : ''}\x1B[u`);
  });
});

const drawStatusBar = () => {
  const cols = process.stdout.columns || 80;
  const vis = visLabel(state.visibility);
  const cat = getCategoryName();
  const parts = [
    chalk.bgBlue.white(` ${state.model} `),
    chalk.bgMagenta.white(` ${getBlogName() || '미연결'} `),
    chalk.bgHex('#6A0DAD').white(` ${cat} `),
    chalk.bgHex('#D4A017').black(` ${vis} `),
    chalk.bgRed.white(` ${state.tone} `),
    state.draft ? chalk.bgYellow.black(` 초안: ${state.draft.title.slice(0, 20)} `) : '',
  ].filter(Boolean);
  const bar = parts.join(chalk.dim(' │ '));
  console.log(chalk.dim('─'.repeat(cols)));
  console.log(bar);
  console.log(chalk.dim('─'.repeat(cols)));
};

const prompt = () => {
  drawStatusBar();
  return new Promise((resolve) => rl.question(chalk.bold.green('viruagent> '), resolve));
};

const stripHtml = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// 커맨드 핸들러
const commands = {
  async write(args) {
    const topic = args.join(' ');
    if (!topic) return log.warn('사용법: /write <주제>');

    try {
      state.draft = await withSpinner(`"${topic}" 주제로 글을 생성하는 중...`, () =>
        generatePost(topic, { model: state.model, tone: state.tone }),
      );
      log.success(`글 생성 완료: "${state.draft.title}"`);
      log.dim(`태그: ${state.draft.tags}`);
      log.dim('미리보기: /preview | 수정: /edit <지시> | 발행: /publish');
    } catch (e) {
      log.error(`글 생성 실패: ${e.message}`);
    }
  },

  async edit(args) {
    if (!state.draft) return log.warn('초안이 없습니다. /write로 먼저 생성하세요.');
    const instruction = args.join(' ');
    if (!instruction) return log.warn('사용법: /edit <수정 지시>');

    try {
      const result = await withSpinner('글을 수정하는 중...', () =>
        revisePost(state.draft.content, instruction, state.model),
      );
      state.draft.title = result.title;
      state.draft.content = result.content;
      state.draft.tags = result.tags;
      log.success('수정 완료!');
      log.dim('미리보기: /preview | 추가 수정: /edit <지시>');
    } catch (e) {
      log.error(`수정 실패: ${e.message}`);
    }
  },

  preview() {
    if (!state.draft) return log.warn('초안이 없습니다.');

    console.log('');
    log.title(`━━━ ${state.draft.title} ━━━`);
    console.log('');
    console.log(stripHtml(state.draft.content));
    console.log('');
    log.dim(`태그: ${state.draft.tags}`);
    log.dim(`카테고리: ${getCategoryName()} | 공개설정: ${visLabel(state.visibility)}`);
    console.log('');
  },

  async publish() {
    if (!state.draft) return log.warn('초안이 없습니다.');

    log.info('발행하는 중...');
    try {
      const result = await publishPost({
        title: state.draft.title,
        content: state.draft.content,
        visibility: state.visibility,
        category: state.category,
        tag: state.draft.tags,
        thumbnail: state.draft.thumbnailKage || null,
      });
      log.success(`발행 완료! ${result.entryUrl || ''}`);
      state.draft = null;
    } catch (e) {
      log.error(`발행 실패: ${e.message}`);
    }
  },

  async draft() {
    if (!state.draft) return log.warn('초안이 없습니다.');

    log.info('임시저장하는 중...');
    try {
      await saveDraft({ title: state.draft.title, content: state.draft.content });
      log.success('임시저장 완료!');
    } catch (e) {
      log.error(`임시저장 실패: ${e.message}`);
    }
  },

  async list() {
    try {
      const data = await getPosts();
      log.title(`글 목록 (총 ${data.totalCount}개)`);
      data.items?.forEach((p) => {
        const vis = p.visibility === 'PUBLIC' ? '공개' : p.visibility === 'PROTECTED' ? '보호' : '비공개';
        console.log(`  ${chalk.dim(`[${p.id}]`)} ${p.title} ${chalk.dim(`(${vis})`)}`);
      });
    } catch (e) {
      log.error(`목록 조회 실패: ${e.message}`);
    }
  },

  categories() {
    if (!Object.keys(state.categories).length) return log.warn('카테고리가 없습니다.');

    log.title('카테고리 목록');
    Object.entries(state.categories).forEach(([name, id]) => {
      const marker = id === state.category ? chalk.green(' ← 현재') : '';
      console.log(`  ${chalk.dim(id)} → ${name}${marker}`);
    });
  },

  async set(args) {
    const [key, ...rest] = args;
    const value = rest.join(' ');

    if (key === 'category') {
      const names = Object.keys(state.categories);
      if (!names.length) return log.warn('카테고리가 없습니다.');

      if (value) {
        // 직접 이름 지정
        const id = state.categories[value];
        if (id !== undefined) {
          state.category = id;
          log.success(`카테고리 설정: ${value} (${id})`);
        } else {
          log.warn(`"${value}" 카테고리를 찾을 수 없습니다. /categories로 확인하세요.`);
        }
      } else {
        // 인터랙티브 선택
        rl.pause();
        const idx = await selectMenu(names, '카테고리 선택 (↑↓ 이동, Enter 선택, Esc 취소)');
        rl.resume();
        if (idx >= 0) {
          const name = names[idx];
          state.category = state.categories[name];
          log.success(`카테고리 설정: ${name} (${state.categories[name]})`);
        } else {
          log.dim('취소됨');
        }
      }
    } else if (key === 'visibility') {
      const visMap = { 공개: 20, 보호: 15, 비공개: 0 };
      if (visMap[value] !== undefined) {
        state.visibility = visMap[value];
        log.success(`공개설정: ${visLabel(state.visibility)}`);
      } else {
        // 인터랙티브 선택
        const visOptions = ['공개', '보호', '비공개'];
        rl.pause();
        const idx = await selectMenu(visOptions, '공개설정 선택 (↑↓ 이동, Enter 선택, Esc 취소)');
        rl.resume();
        if (idx >= 0) {
          state.visibility = [20, 15, 0][idx];
          log.success(`공개설정: ${visLabel(state.visibility)}`);
        } else {
          log.dim('취소됨');
        }
      }
    } else if (key === 'model') {
      if (value && MODELS.includes(value)) {
        state.model = value;
        log.success(`모델 설정: ${value}`);
      } else {
        // 인터랙티브 선택
        rl.pause();
        const idx = await selectMenu(MODELS, '모델 선택 (↑↓ 이동, Enter 선택, Esc 취소)');
        rl.resume();
        if (idx >= 0) {
          state.model = MODELS[idx];
          log.success(`모델 설정: ${state.model}`);
        } else {
          log.dim('취소됨');
        }
      }
    } else if (key === 'tone') {
      if (value && TONES.includes(value)) {
        state.tone = value;
        log.success(`톤 설정: ${value}`);
      } else {
        rl.pause();
        const idx = await selectMenu(TONES, '톤 선택 (↑↓ 이동, Enter 선택, Esc 취소)');
        rl.resume();
        if (idx >= 0) {
          state.tone = TONES[idx];
          log.success(`톤 설정: ${state.tone}`);
        } else {
          log.dim('취소됨');
        }
      }
    } else if (key === 'api') {
      const keys = loadApiKeys();
      const mask = (v) => v ? `${v.slice(0, 8)}${'*'.repeat(8)}` : chalk.dim('(미설정)');

      console.log();
      log.title('API Key 설정');
      console.log(`  OpenAI:    ${mask(keys.OPENAI_API_KEY)}`);
      console.log(`  Unsplash:  ${mask(keys.UNSPLASH_ACCESS_KEY)}`);
      console.log();

      rl.pause();
      const apiOptions = ['OpenAI API Key', 'Unsplash Access Key', '취소'];
      const idx = await selectMenu(apiOptions, 'API Key 선택 (↑↓ 이동, Enter 선택, Esc 취소)');
      rl.resume();

      if (idx === 0) {
        rl.pause();
        const newKey = await askQuestion(chalk.cyan('  새 OpenAI API Key: '));
        rl.resume();
        if (newKey) {
          saveApiKeys({ OPENAI_API_KEY: newKey });
          log.success('OpenAI API Key가 저장되었습니다.');
          log.warn('다음 세션부터 적용됩니다. 프로그램을 재시작하세요.');
        } else {
          log.dim('변경 없음');
        }
      } else if (idx === 1) {
        rl.pause();
        const newKey = await askQuestion(chalk.cyan('  새 Unsplash Access Key (삭제하려면 빈 값): '));
        rl.resume();
        if (newKey) {
          saveApiKeys({ UNSPLASH_ACCESS_KEY: newKey });
          log.success('Unsplash Access Key가 저장되었습니다.');
          log.warn('다음 세션부터 적용됩니다. 프로그램을 재시작하세요.');
        } else if (keys.UNSPLASH_ACCESS_KEY) {
          saveApiKeys({ UNSPLASH_ACCESS_KEY: '' });
          log.success('Unsplash Access Key가 삭제되었습니다.');
          log.warn('다음 세션부터 적용됩니다. 프로그램을 재시작하세요.');
        } else {
          log.dim('변경 없음');
        }
      } else {
        log.dim('취소됨');
      }
      return;
    } else {
      return log.warn('사용법: /set category | /set visibility | /set model | /set tone | /set api');
    }
    saveSettings();
  },

  help() {
    console.log(`
${chalk.bold('ViruAgent 명령어')}

${chalk.cyan('/write <주제>')}      AI가 블로그 글 초안 생성
${chalk.cyan('/edit <지시>')}       현재 초안 수정
${chalk.cyan('/preview')}           현재 초안 미리보기
${chalk.cyan('/publish')}           글 발행
${chalk.cyan('/draft')}             임시저장
${chalk.cyan('/list')}              글 목록 조회
${chalk.cyan('/categories')}        카테고리 목록
${chalk.cyan('/set category')}      카테고리 설정
${chalk.cyan('/set visibility')}    공개설정
${chalk.cyan('/set model')}         AI 모델 선택
${chalk.cyan('/set tone')}          글쓰기 톤 설정
${chalk.cyan('/set api')}           API Key 관리 (OpenAI, Unsplash)
${chalk.cyan('/login')}             티스토리 로그인
${chalk.cyan('/logout')}            로그아웃 (세션 삭제)
${chalk.cyan('/help')}              도움말
${chalk.cyan('/exit')}              종료

슬래시 없이 자연어로 입력하면 AI가 자율적으로 도구를 호출합니다.
${chalk.dim('예: "AI 트렌드로 글 써줘", "서론을 더 흥미롭게 수정해줘", "발행해줘"')}
`);
  },

  logout() {
    const sessionPath = path.join(__dirname, '..', 'data', 'session.json');
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
      log.success('세션이 삭제되었습니다.');
    } else {
      log.warn('세션 파일이 없습니다.');
    }
    state.categories = {};
    state.category = 0;
    log.info('로그아웃되었습니다. 프로그램을 종료합니다.');
    process.exit(0);
  },

  async login() {
    log.info('브라우저를 열어 로그인합니다...');
    try {
      const { execSync } = require('child_process');
      execSync('node lib/login.js', { cwd: __dirname, stdio: 'inherit' });
      log.success('로그인 완료!');
      await initBlog();
      log.success(`블로그 감지: ${getBlogName()}`);
      state.categories = await getCategories();
      log.success(`${Object.keys(state.categories).length}개 카테고리 로드 완료`);
    } catch (e) {
      log.error(`로그인 실패: ${e.message}`);
    }
  },

  exit() {
    log.info('안녕히 가세요!');
    rl.close();
    process.exit(0);
  },
};

const getCategoryName = () => {
  const entry = Object.entries(state.categories).find(([, id]) => id === state.category);
  return entry ? entry[0] : '없음';
};

const handleInput = async (input) => {
  const trimmed = input.trim();
  if (!trimmed) return;

  if (trimmed.startsWith('/')) {
    const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
    const handler = commands[cmd];
    if (handler) {
      await handler(args);
    } else {
      log.warn(`알 수 없는 명령어: /${cmd}. /help로 확인하세요.`);
    }
  } else {
    // 에이전트 루프 (자연어 → 자율 도구 호출)
    try {
      // Braille 도트 애니메이션 (텍스트 없이)
      const DOT_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      const DOT_COLORS = [chalk.cyan, chalk.blue, chalk.magenta, chalk.blue];
      let spinnerTimer = null;
      let spinnerIdx = 0;

      const startSpinner = () => {
        stopSpinner();
        spinnerTimer = setInterval(() => {
          const colorFn = DOT_COLORS[Math.floor(spinnerIdx / 3) % DOT_COLORS.length];
          process.stdout.write(`\r\x1B[K  ${colorFn(DOT_FRAMES[spinnerIdx++ % DOT_FRAMES.length])}`);
        }, 80);
      };

      const stopSpinner = () => {
        if (spinnerTimer) {
          clearInterval(spinnerTimer);
          spinnerTimer = null;
          process.stdout.write('\r\x1B[K');
        }
      };

      startSpinner();

      const reply = await runAgent(trimmed, {
        state,
        publishPost: publishPost,
        onToolCall: () => {},
        onToolResult: (name, result) => {
          stopSpinner();
          if (result?.error) {
            log.warn(result.error);
          } else if (name === 'generate_post' && result?.title) {
            log.success(`글 생성 완료: "${result.title}"`);
          } else if (name === 'edit_post' && result?.title) {
            log.success(`수정 완료: "${result.title}"`);
          } else if (name === 'publish_post' && result?.url) {
            log.success(`발행 완료! ${result.url}`);
          } else if (name === 'set_category' && result?.category) {
            log.success(`카테고리 설정: ${result.category}`);
          } else if (name === 'set_visibility' && result?.visibility) {
            log.success(`공개설정: ${result.visibility}`);
          }
          startSpinner();
        },
      });

      stopSpinner();
      console.log(`\n${chalk.blue('AI')}\n${reply}\n`);
    } catch (e) {
      log.error(`대화 실패: ${e.message}`);
    }
  }
};

const askQuestion = (query) =>
  new Promise((resolve) => {
    const tmpRl = readline.createInterface({ input: process.stdin, output: process.stdout });
    tmpRl.question(query, (answer) => {
      tmpRl.close();
      resolve(answer.trim());
    });
  });

const loadApiKeys = () => {
  const settings = loadSettings();
  return {
    OPENAI_API_KEY: settings.openaiApiKey || '',
    UNSPLASH_ACCESS_KEY: settings.unsplashAccessKey || '',
  };
};

const saveApiKeys = (keys) => {
  ensureConfigDir();
  const current = loadSettings();
  if (keys.OPENAI_API_KEY !== undefined) current.openaiApiKey = keys.OPENAI_API_KEY || undefined;
  if (keys.UNSPLASH_ACCESS_KEY !== undefined) current.unsplashAccessKey = keys.UNSPLASH_ACCESS_KEY || undefined;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2));
  // 환경 변수에 반영
  if (keys.OPENAI_API_KEY) process.env.OPENAI_API_KEY = keys.OPENAI_API_KEY;
  if (keys.UNSPLASH_ACCESS_KEY) process.env.UNSPLASH_ACCESS_KEY = keys.UNSPLASH_ACCESS_KEY;
};

const applyApiKeys = () => {
  const keys = loadApiKeys();
  if (keys.OPENAI_API_KEY) process.env.OPENAI_API_KEY = keys.OPENAI_API_KEY;
  if (keys.UNSPLASH_ACCESS_KEY) process.env.UNSPLASH_ACCESS_KEY = keys.UNSPLASH_ACCESS_KEY;
};

const setupEnv = async () => {
  applyApiKeys();
  if (process.env.OPENAI_API_KEY) return;

  console.log();
  log.title('━━━ 초기 설정 ━━━');
  console.log();
  log.info('OpenAI API Key가 설정되지 않았습니다.\n');
  log.dim('  https://platform.openai.com/api-keys 에서 발급받을 수 있습니다.\n');

  const openaiKey = await askQuestion(chalk.cyan('  OpenAI API Key: '));
  if (!openaiKey) {
    log.error('OpenAI API Key는 필수입니다. 프로그램을 종료합니다.');
    process.exit(1);
  }

  // OpenAI Key 검증
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${openaiKey}` },
    });
    if (!res.ok) {
      log.error('OpenAI API Key가 유효하지 않습니다. 키를 확인 후 다시 시도하세요.');
      process.exit(1);
    }
    log.success('OpenAI API Key 확인 완료!');
  } catch {
    log.error('OpenAI 서버에 연결할 수 없습니다. 네트워크를 확인하세요.');
    process.exit(1);
  }

  const unsplashKey = await askQuestion(chalk.cyan('  Unsplash Access Key (선택, Enter로 건너뛰기): '));

  if (unsplashKey) {
    try {
      const res = await fetch('https://api.unsplash.com/photos/random?count=1', {
        headers: { Authorization: `Client-ID ${unsplashKey}` },
      });
      if (!res.ok) {
        log.warn('Unsplash Key가 유효하지 않습니다. 건너뜁니다.');
      } else {
        log.success('Unsplash Access Key 확인 완료!');
      }
    } catch {
      log.warn('Unsplash 서버에 연결할 수 없습니다. 건너뜁니다.');
    }
  }

  saveApiKeys({
    OPENAI_API_KEY: openaiKey,
    ...(unsplashKey && { UNSPLASH_ACCESS_KEY: unsplashKey }),
  });
  log.success(`설정이 저장되었습니다! (${CONFIG_PATH})\n`);
  if (!unsplashKey) log.dim('  Unsplash는 나중에 /set api 에서 설정할 수 있습니다.\n');
};

const main = async () => {
  await animateBanner();

  // API Key 없으면 초기 설정
  await setupEnv();

  // 세션 체크 — 로그인 필수
  while (!fs.existsSync(path.join(__dirname, '..', 'data', 'session.json'))) {
    log.warn('세션 파일(session.json)이 없습니다. 티스토리 로그인이 필요합니다.');
    log.info('브라우저를 열어 로그인합니다...');
    try {
      const { execSync } = require('child_process');
      execSync('node lib/login.js', { cwd: __dirname, stdio: 'inherit' });
      log.success('로그인 완료!');
    } catch (e) {
      log.error(`로그인 실패: ${e.message}`);
      log.warn('다시 시도합니다...\n');
    }
  }

  // 부팅 시퀀스
  console.log(chalk.dim('  시스템 초기화 중...\n'));

  try {
    await showBootStep(
      'OpenAI 연결',
      async () => {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        });
        if (!res.ok) throw new Error('키가 유효하지 않습니다');
      },
      1000,
    );
  } catch (e) {
    log.warn(`  OpenAI 연결 실패: ${e.message}\n  ${chalk.dim('/set api 명령어로 키를 확인하세요.')}`);
  }

  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      await showBootStep(
        'Unsplash 연결',
        async () => {
          const res = await fetch('https://api.unsplash.com/photos/random?count=1', {
            headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
          });
          if (!res.ok) throw new Error('키가 유효하지 않습니다');
        },
        1000,
      );
    } catch (e) {
      log.warn(`  Unsplash 연결 실패: ${e.message}\n  ${chalk.dim('/set api 명령어로 키를 확인하세요.')}`);
    }
  }

  let blogOk = false;
  try {
    await showBootStep(
      '티스토리 연결',
      async () => {
        await initBlog();
        state.categories = await getCategories();
      },
      1200,
    );
    blogOk = true;
  } catch (e) {
    if (!blogOk) log.warn(`  티스토리 연결 실패: ${e.message}\n  ${chalk.dim('/login 명령어로 다시 로그인하세요.')}`);
  }

  console.log();
  console.log(chalk.dim('  /help로 명령어 확인 | 자유롭게 대화하며 글을 작성하세요'));
  console.log();

  // 메인 루프
  while (true) {
    const input = await prompt();
    await handleInput(input);
  }
};

main().catch((e) => {
  log.error(`치명적 오류: ${e.message}`);
  process.exit(1);
});
