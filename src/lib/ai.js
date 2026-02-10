const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

if (!process.env.OPENAI_API_KEY) {
  console.error('\x1b[31m✗ OPENAI_API_KEY가 설정되지 않았습니다.\x1b[0m');
  console.error('\x1b[33m  1. 프로젝트 루트에 .env 파일을 생성하세요');
  console.error('  2. OPENAI_API_KEY=sk-... 형식으로 키를 입력하세요');
  console.error('  3. https://platform.openai.com/api-keys 에서 키를 발급받을 수 있습니다\x1b[0m');
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const handleApiError = (e) => {
  if (e?.status === 401 || e?.code === 'invalid_api_key') {
    throw new Error('OpenAI API 키가 유효하지 않습니다. .env 파일의 OPENAI_API_KEY를 확인하세요.');
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

const loadConfig = () => {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
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

/**
 * 블로그 글 초안 생성
 * @param {string} topic - 주제
 * @param {Object} [options]
 * @param {string} [options.tone] - 말투
 * @param {number} [options.length] - 대략적인 글자 수
 * @param {string} [options.model] - 모델명
 * @returns {Promise<{title: string, content: string, tags: string}>}
 */
const generatePost = async (topic, options = {}) => {
  const config = loadConfig();
  const {
    tone = config.defaultTone,
    length = config.defaultLength,
    model = config.defaultModel,
  } = options;

  let res;
  try {
    res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: config.systemPrompt },
        {
          role: 'user',
          content: `주제: ${topic}
말투: ${tone}
분량: 약 ${length}자

작성 요구사항:
- 제목은 검색 키워드를 포함하면서 클릭을 유도하는 형태로 작성 (숫자 활용 권장)
- 본문은 도입부 → 번호 매긴 h2 소제목들 → 자주 묻는 질문(h3) → 마무리(h3) 구조
- 각 소제목 섹션에는 설명 + 불릿 포인트 + 👉 팁 포함
- 태그는 검색 유입에 효과적인 키워드 5~7개

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

  return JSON.parse(res.choices[0].message.content);
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
    res = await client.chat.completions.create({
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
    res = await client.chat.completions.create({
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

module.exports = { generatePost, revisePost, chat, MODELS, loadConfig };
