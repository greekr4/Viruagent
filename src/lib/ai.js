const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
let client;
const getClient = () => {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY가 설정되지 않았습니다. /set api 로 키를 설정하세요.');
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
};

const { replaceImagePlaceholders } = require('./unsplash');
const { searchWeb } = require('./websearch');
const { readRecentPatterns, recordPublishedPattern } = require('./pattern-store');
const { pickAllowedTitleTypes, isAllowedTitle, inferTitleType } = require('./title-policy');
const { pickStructureTemplate, summarizeRecentPatterns } = require('./structure-policy');
const { createLogger } = require('./logger');
const aiLog = createLogger('ai');

const handleApiError = (e) => {
  if (e?.status === 401 || e?.code === 'invalid_api_key') {
    throw new Error('OpenAI API 키가 유효하지 않습니다. /set api 로 키를 확인하세요.');
  }
  if (e?.status === 429) {
    throw new Error('API 요청 한도를 초과했습니다. 잠시 후 다시 시도하거나 요금제를 확인하세요.');
  }
  if (e?.status === 403) {
    throw new Error('API 키에 해당 모델 접근 권한이 없습니다. OpenAI 대시보드에서 권한을 확인하세요.');
  }
  throw e;
};

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'prompt-config.json');
const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', '..', 'config', 'system-prompt.md');

const loadConfig = () => {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  config.webSearch = {
    enabled: true,
    provider: 'duckduckgo',
    defaultMaxResults: 5,
    timeoutMs: 8000,
    ...(config.webSearch || {}),
  };
  config.systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
  return config;
};

const MODELS = [
  // GPT-4o
  'gpt-4o-mini', 'gpt-4o',
  // GPT-4.1
  'gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4.1',
  // GPT-5
  'gpt-5-nano', 'gpt-5-mini', 'gpt-5',
  // GPT-5.1
  'gpt-5.1', 'gpt-5.1-codex-mini', 'gpt-5.1-codex',
  // GPT-5.2
  'gpt-5.2', 'gpt-5.2-pro', 'gpt-5.2-codex',
  // Reasoning
  'o3-mini', 'o3', 'o3-pro', 'o4-mini',
];

// reasoning 모델은 temperature를 지원하지 않음
const REASONING_MODELS = /^(o[1-9]|o\d+-)/;
const isReasoningModel = (model) => REASONING_MODELS.test(model);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeQuery = (text = '') =>
  String(text).toLowerCase().replace(/\s+/g, ' ').trim();

const isSimilarQuery = (a, b) => {
  const q1 = normalizeQuery(a);
  const q2 = normalizeQuery(b);
  if (!q1 || !q2) return false;
  return q1 === q2 || q1.includes(q2) || q2.includes(q1);
};

const extractFocusKeywords = (topic = '') => {
  const tokens = String(topic)
    .match(/[A-Za-z0-9+#.-]{2,}|[가-힣]{2,}/g);

  if (!tokens) return [];

  const stopWords = new Set(['차이', '비교', '가이드', '정리', '최신', '이슈', '대한', '관련']);
  const uniq = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (stopWords.has(key)) continue;
    if (!uniq.some((x) => x.toLowerCase() === key)) uniq.push(token);
  }

  return uniq.slice(0, 8);
};

const buildResearchPromptBlock = (webResearch) => {
  if (!webResearch) {
    return '웹검색 참고자료: 검색 컨텍스트 없음. 일반적인 지식과 원칙을 기반으로 작성하세요.';
  }

  if (!Array.isArray(webResearch.results) || webResearch.results.length === 0) {
    return `웹검색 참고자료:
- 검색어: ${webResearch.query || '없음'}
- 검색 시각: ${webResearch.fetchedAt || '없음'}
- 결과 없음: 과도한 단정 없이 일반 원칙 중심으로 작성하세요.`;
  }

  const items = webResearch.results
    .slice(0, 5)
    .map(
      (item, idx) =>
        `${idx + 1}. 제목: ${item.title}\n   요약: ${item.snippet || '요약 없음'}\n   URL: ${item.url}`,
    )
    .join('\n');

  return `웹검색 참고자료:
- 검색어: ${webResearch.query || '없음'}
- 검색 시각: ${webResearch.fetchedAt || '없음'}
- 결과:
${items}`;
};

const getWebSearchOptions = (config, maxResultsOverride) => {
  const fallbackMax = Number(config.webSearch?.defaultMaxResults) || 5;
  const maxResults =
    maxResultsOverride != null ? clamp(Number(maxResultsOverride) || fallbackMax, 1, 8) : fallbackMax;

  return {
    maxResults,
    timeoutMs: Number(config.webSearch?.timeoutMs) || 8000,
  };
};

const titleTypeLabel = (type) => {
  const map = {
    numeric: '숫자형',
    question: '질문형',
    contrast: '대조형',
    statement: '문장형',
  };
  return map[type] || type;
};

const stripHtml = (html = '') =>
  String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const regenerateTitleByPolicy = async ({ model, topic, tone, content, allowedTypes }) => {
  let res;
  try {
    const allowedText = allowedTypes.map((t) => titleTypeLabel(t)).join(', ');
    const plain = stripHtml(content).slice(0, 800);
    res = await getClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: '당신은 블로그 제목 생성기입니다. 입력된 주제와 본문 요약을 바탕으로 허용된 타입의 제목만 생성하세요.' },
        {
          role: 'user',
          content: `주제: ${topic}
말투: ${tone}
허용 제목 타입: ${allowedText}
본문 요약:
${plain}

다음 JSON 형식으로 응답하세요:
{"title": "허용 타입을 지킨 제목"}`,
        },
      ],
      response_format: { type: 'json_object' },
      ...(!isReasoningModel(model) && { temperature: 0.4 }),
    });
  } catch (e) {
    handleApiError(e);
  }

  const parsed = JSON.parse(res.choices[0].message.content || '{}');
  return (parsed.title || '').trim() || null;
};

/**
 * 블로그 글 초안 생성
 * @param {string} topic - 주제
 * @param {Object} [options]
 * @param {string} [options.tone] - 말투
 * @param {number} [options.length] - 대략적인 글자 수
 * @param {string} [options.model] - 모델명
 * @param {{query: string, fetchedAt: string, results: Array<{title: string, url: string, snippet: string}>} | null} [options.webResearch] - 웹검색 컨텍스트
 * @param {string} [options.categoryName] - 카테고리 이름
 * @param {Array<Object>} [options.recentPatterns] - 최근 발행 패턴 요약
 * @returns {Promise<{title: string, content: string, tags: string}>}
 */
const generatePost = async (topic, options = {}) => {
  const config = loadConfig();
  const {
    tone = config.defaultTone,
    length = config.defaultLength,
    model = config.defaultModel,
    webResearch: providedWebResearch,
    categoryName = 'Heartbeat',
    recentPatterns: providedRecentPatterns,
  } = options;
  let webResearch = providedWebResearch;
  const recentPatterns = Array.isArray(providedRecentPatterns)
    ? providedRecentPatterns
    : readRecentPatterns({ category: categoryName, limit: 5 });
  const titlePolicy = pickAllowedTitleTypes(recentPatterns, 0.4);
  const structurePlan = pickStructureTemplate({ topic, recentPatterns });
  const recentPatternSummary = summarizeRecentPatterns(recentPatterns);

  if (webResearch === undefined && config.webSearch?.enabled !== false) {
    try {
      webResearch = await searchWeb(topic, getWebSearchOptions(config));
    } catch (e) {
      aiLog.warn('웹검색 컨텍스트 확보 실패', { topic, error: e.message });
      webResearch = null;
    }
  }

  const researchPrompt = buildResearchPromptBlock(webResearch);
  const focusKeywords = extractFocusKeywords(topic);
  const focusKeywordLine = focusKeywords.length ? focusKeywords.join(', ') : topic;
  const allowedTitleTypesLabel = titlePolicy.allowed.map((t) => titleTypeLabel(t)).join(', ');
  aiLog.info('글 생성 입력 준비', {
    topic,
    categoryName,
    hasWebResearch: !!webResearch,
    webResultCount: webResearch?.results?.length || 0,
    allowedTitleTypes: titlePolicy.allowed,
    structureType: structurePlan.id,
  });

  let res;
  try {
    res = await getClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: config.systemPrompt },
        {
          role: 'user',
          content: `주제: ${topic}
말투: ${tone}
분량: 약 ${length}자

${researchPrompt}

핵심 주제 키워드: ${focusKeywordLine}

작성 요구사항:
- 제목은 검색 키워드를 포함하면서 클릭을 유도하되, 허용된 제목 타입만 사용
- 주제에 가장 적합한 글 유형과 구조를 자율적으로 선택하여 작성
- 본문 중 적절한 위치에 <!-- IMAGE: 영문키워드 --> 플레이스홀더를 3개 내외 삽입
- 태그는 검색 유입에 효과적인 키워드 5~7개
- 웹검색 참고자료가 있으면 최신성과 사실성을 우선 반영
- 참고자료가 부족하거나 상충하면 단정적 표현을 피하고 불확실성을 반영
- 글의 범위가 주제에서 벗어나지 않도록 유지하고, 핵심 주제 키워드 기준으로 섹션을 구성
- 가격/요금제/날짜/버전 등 수치형 정보는 검색 참고자료에서 확인된 경우만 단정적으로 작성
- 수치형 근거가 약하면 "시점에 따라 변동될 수 있음"으로 표현하고 과도한 단정 금지
- 본문 HTML에는 참고 링크(URL)나 출처 섹션을 직접 노출하지 말 것
- 허용 제목 타입: ${allowedTitleTypesLabel}
- 최근 글 패턴 요약:
${recentPatternSummary}
- 이번 글 구조 템플릿: ${structurePlan.id}
- 템플릿 지시:
${structurePlan.instruction}

다음 JSON 형식으로 응답하세요:
{"title": "글 제목", "content": "<p>HTML 본문...</p>", "tags": "태그1,태그2,태그3,태그4,태그5"}`,
        },
      ],
      response_format: { type: 'json_object' },
      ...(!isReasoningModel(model) && { temperature: 0.7 }),
    });
  } catch (e) {
    handleApiError(e);
  }

  const result = JSON.parse(res.choices[0].message.content);
  const titleCheck = isAllowedTitle(result.title, titlePolicy.allowed);
  if (!titleCheck.ok) {
    aiLog.warn('제목 타입 정책 위반, 제목 재생성 시도', {
      topic,
      originalTitle: result.title,
      originalType: titleCheck.type,
      allowed: titlePolicy.allowed,
    });
    const regenerated = await regenerateTitleByPolicy({
      model,
      topic,
      tone,
      content: result.content,
      allowedTypes: titlePolicy.allowed,
    });
    if (regenerated) {
      const retryCheck = isAllowedTitle(regenerated, titlePolicy.allowed);
      if (retryCheck.ok) result.title = regenerated;
    }
  }

  result._meta = {
    topic,
    categoryName,
    structureType: structurePlan.id,
    sectionKeys: structurePlan.sectionKeys,
    titleType: inferTitleType(result.title),
    allowedTitleTypes: titlePolicy.allowed,
  };
  aiLog.info('GPT 응답 수신', { title: result.title, contentLength: result.content?.length });

  // 티스토리 업로드 함수가 있으면 전달 (initBlog 완료 상태에서만 동작)
  let uploadFn;
  try {
    const { uploadImage } = require('./tistory');
    uploadFn = uploadImage;
  } catch (e) {
    aiLog.warn('tistory uploadImage 로드 실패', { error: e.message });
  }
  const imageResult = await replaceImagePlaceholders(result.content, { uploadFn });
  result.content = imageResult.html;
  result.thumbnailUrl = imageResult.thumbnailUrl;
  result.thumbnailKage = imageResult.thumbnailKage;
  aiLog.info('이미지 처리 완료', { thumbnailKage: result.thumbnailKage });

  return result;
};

/**
 * 글 수정
 * @param {string} content - 현재 HTML 본문
 * @param {string} instruction - 수정 지시
 * @returns {Promise<{title: string, content: string, tags: string}>}
 */
const revisePost = async (content, instruction, model) => {
  const config = loadConfig();
  model = model || config.defaultModel;

  let res;
  try {
    res = await getClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: config.systemPrompt },
        {
          role: 'user',
          content: `다음 글을 수정해주세요.

수정 지시: ${instruction}

현재 본문:
${content}

다음 JSON 형식으로 응답하세요:
{"title": "수정된 제목", "content": "<p>수정된 HTML 본문...</p>", "tags": "태그1,태그2,태그3,태그4,태그5"}`,
        },
      ],
      response_format: { type: 'json_object' },
      ...(!isReasoningModel(model) && { temperature: 0.7 }),
    });
  } catch (e) {
    handleApiError(e);
  }

  return JSON.parse(res.choices[0].message.content);
};

/**
 * 자유 대화
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
const chat = async (messages, model) => {
  const config = loadConfig();
  model = model || config.defaultModel;

  let res;
  try {
    res = await getClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: '당신은 블로그 글쓰기를 돕는 AI 어시스턴트입니다. 주제 논의, 아이디어 브레인스토밍, 글 구조 제안 등을 도와줍니다. 한국어로 대화하세요.' },
        ...messages,
      ],
      ...(!isReasoningModel(model) && { temperature: 0.7 }),
    });
  } catch (e) {
    handleApiError(e);
  }

  return res.choices[0].message.content;
};

// ─── Agent Pattern: Tool Definitions ───

const AGENT_PROMPT_PATH = path.join(__dirname, '..', '..', 'config', 'agent-prompt.md');

const loadAgentPrompt = () => {
  try {
    return fs.readFileSync(AGENT_PROMPT_PATH, 'utf-8');
  } catch {
    return '당신은 블로그 글쓰기를 돕는 AI 에이전트입니다. 한국어로 대화하세요.';
  }
};

const agentTools = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: '웹에서 최신 정보를 검색합니다. 글 작성 전 사실 확인이나 트렌드 파악이 필요할 때 사용합니다.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '검색어' },
          max_results: { type: 'integer', description: '가져올 최대 결과 수 (1~8)', minimum: 1, maximum: 8 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_post',
      description: '블로그 글 초안을 생성합니다.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: '글 주제' },
          tone: { type: 'string', description: '글 톤/말투 (선택)' },
        },
        required: ['topic'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_post',
      description: '현재 초안을 수정합니다.',
      parameters: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: '수정 지시사항' },
        },
        required: ['instruction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_post',
      description: '현재 초안을 미리봅니다.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_post',
      description: '현재 초안을 블로그에 발행합니다.',
      parameters: {
        type: 'object',
        properties: {
          visibility: { type: 'number', description: '공개설정 (20=공개, 15=보호, 0=비공개)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_category',
      description: '블로그 카테고리를 변경합니다.',
      parameters: {
        type: 'object',
        properties: {
          category_name: { type: 'string', description: '카테고리 이름' },
        },
        required: ['category_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_visibility',
      description: '공개설정을 변경합니다.',
      parameters: {
        type: 'object',
        properties: {
          visibility: {
            type: 'string',
            enum: ['공개', '보호', '비공개'],
            description: '공개설정',
          },
        },
        required: ['visibility'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_blog_status',
      description: '현재 블로그 상태를 조회합니다 (초안 유무, 카테고리, 모델 등).',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/**
 * 에이전트 루프 실행
 * @param {string} userMessage - 사용자 입력
 * @param {Object} context - 외부 의존성
 * @param {Object} context.state - 앱 상태 (draft, categories, model, tone 등)
 * @param {Function} context.publishPost - 발행 함수
 * @param {Function} context.saveDraft - 임시저장 함수
 * @param {Function} context.getCategories - 카테고리 조회
 * @param {Function} context.onToolCall - 도구 호출 시 콜백 (name, args) => void
 * @param {Function} context.onToolResult - 도구 결과 콜백 (name, result) => void
 * @returns {Promise<string>} AI 최종 텍스트 응답
 */
const runAgent = async (userMessage, context) => {
  const { state, publishPost: publishFn, onToolCall, onToolResult } = context;
  const config = loadConfig();
  const model = state.model || config.defaultModel;

  // 대화 히스토리에 사용자 메시지 추가
  state.chatHistory.push({ role: 'user', content: userMessage });

  const messages = [
    { role: 'system', content: loadAgentPrompt() },
    ...state.chatHistory,
  ];

  const MAX_LOOPS = 10;

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    let res;
    try {
      res = await getClient().chat.completions.create({
        model,
        messages,
        tools: agentTools,
        ...(!isReasoningModel(model) && { temperature: 0.7 }),
      });
    } catch (e) {
      handleApiError(e);
    }

    const choice = res.choices[0];
    const msg = choice.message;

    // 메시지를 히스토리에 추가
    messages.push(msg);

    // tool_calls가 없으면 텍스트 응답 반환
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const text = msg.content || '';
      state.chatHistory.push({ role: 'assistant', content: text });
      return text;
    }

    // tool_calls 처리
    for (const toolCall of msg.tool_calls) {
      const fnName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || '{}');

      if (onToolCall) onToolCall(fnName, args);

      let result;
      try {
        result = await executeAgentTool(fnName, args, { state, publishFn, config });
      } catch (e) {
        result = { error: e.message };
      }

      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

      if (onToolResult) onToolResult(fnName, result);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: resultStr,
      });
    }
  }

  // 루프 초과 시
  const fallback = '작업이 너무 많은 단계를 거쳤습니다. 현재까지의 진행 상황을 확인해주세요.';
  state.chatHistory.push({ role: 'assistant', content: fallback });
  return fallback;
};

/**
 * 에이전트 도구 실행
 */
const NEEDS_LOGIN = ['publish_post', 'set_category'];

const executeAgentTool = async (name, args, { state, publishFn, config }) => {
  if (NEEDS_LOGIN.includes(name) && !state.blogConnected) {
    return { error: '티스토리 로그인이 필요합니다. /login 명령어로 먼저 로그인하세요.' };
  }

  switch (name) {
    case 'search_web': {
      if (config.webSearch?.enabled === false) {
        return { error: '웹검색 기능이 비활성화되어 있습니다.' };
      }

      const maxResults = args.max_results != null ? args.max_results : undefined;
      const result = await searchWeb(args.query, getWebSearchOptions(config, maxResults));
      state.lastWebResearch = result;
      return {
        success: true,
        query: result.query,
        fetchedAt: result.fetchedAt,
        count: result.results.length,
        results: result.results,
      };
    }

    case 'generate_post': {
      const tone = args.tone || state.tone || config.defaultTone;
      let webResearch = state.lastWebResearch;
      const categoryName = Object.entries(state.categories || {}).find(([, id]) => id === state.category)?.[0] || 'Heartbeat';
      const recentPatterns = readRecentPatterns({ category: categoryName, limit: 5 });

      if (!webResearch || !isSimilarQuery(webResearch.query, args.topic)) {
        try {
          webResearch = await searchWeb(args.topic, getWebSearchOptions(config));
          state.lastWebResearch = webResearch;
        } catch (e) {
          aiLog.warn('에이전트 웹검색 실패, 생성 계속 진행', { topic: args.topic, error: e.message });
          webResearch = null;
        }
      }

      const result = await generatePost(args.topic, {
        model: state.model,
        tone,
        webResearch,
        categoryName,
        recentPatterns,
      });
      state.draft = result;
      return { success: true, title: result.title, tags: result.tags };
    }

    case 'edit_post': {
      if (!state.draft) return { error: '초안이 없습니다. 먼저 글을 생성해주세요.' };
      const result = await revisePost(state.draft.content, args.instruction, state.model);
      state.draft.title = result.title;
      state.draft.content = result.content;
      state.draft.tags = result.tags;
      return { success: true, title: result.title, tags: result.tags };
    }

    case 'preview_post': {
      if (!state.draft) return { error: '초안이 없습니다.' };
      const plain = state.draft.content
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      return {
        title: state.draft.title,
        preview: plain.slice(0, 500) + (plain.length > 500 ? '...' : ''),
        tags: state.draft.tags,
      };
    }

    case 'publish_post': {
      if (!state.draft) return { error: '초안이 없습니다.' };
      const vis = args.visibility != null ? args.visibility : state.visibility;
      const result = await publishFn({
        title: state.draft.title,
        content: state.draft.content,
        visibility: vis,
        category: state.category,
        tag: state.draft.tags,
        thumbnail: state.draft.thumbnailKage || null,
      });
      const url = result.entryUrl || '';
      const categoryName = Object.entries(state.categories || {}).find(([, id]) => id === state.category)?.[0] || 'Heartbeat';
      recordPublishedPattern({
        title: state.draft.title,
        topic: state.draft?._meta?.topic || '',
        content: state.draft.content,
        url,
        postId: result?.post?.id || result?.id || null,
        category: categoryName,
        generationMeta: state.draft?._meta || null,
      });
      state.draft = null;
      return { success: true, url };
    }

    case 'set_category': {
      const id = state.categories[args.category_name];
      if (id === undefined) {
        return { error: `"${args.category_name}" 카테고리를 찾을 수 없습니다.`, available: Object.keys(state.categories) };
      }
      state.category = id;
      return { success: true, category: args.category_name, id };
    }

    case 'set_visibility': {
      const visMap = { '공개': 20, '보호': 15, '비공개': 0 };
      if (visMap[args.visibility] === undefined) {
        return { error: '유효하지 않은 공개설정입니다. 공개/보호/비공개 중 선택하세요.' };
      }
      state.visibility = visMap[args.visibility];
      return { success: true, visibility: args.visibility };
    }

    case 'get_blog_status': {
      return {
        hasDraft: !!state.draft,
        draftTitle: state.draft?.title || null,
        category: Object.entries(state.categories).find(([, id]) => id === state.category)?.[0] || '없음',
        visibility: state.visibility === 20 ? '공개' : state.visibility === 15 ? '보호' : '비공개',
        model: state.model,
        tone: state.tone,
        availableCategories: Object.keys(state.categories),
      };
    }

    default:
      return { error: `알 수 없는 도구: ${name}` };
  }
};

module.exports = { generatePost, revisePost, chat, runAgent, MODELS, loadConfig };
