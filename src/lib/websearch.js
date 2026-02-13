const { createLogger } = require('./logger');

const webLog = createLogger('websearch');

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 8;

const OFFICIAL_DOMAINS = new Set([
  'openai.com',
  'chatgpt.com',
  'help.openai.com',
  'status.openai.com',
  'platform.openai.com',
]);

const TRUSTED_NEWS_DOMAINS = new Set([
  'reuters.com',
  'www.reuters.com',
  'www.digitaltrends.com',
  'www.techradar.com',
  'www.zdnet.com',
  'www.nytimes.com',
  'www.bloomberg.com',
  'www.theverge.com',
  'techcrunch.com',
  'www.wired.com',
  'www.forbes.com',
]);

const LOW_TRUST_DOMAINS = new Set([
  'reddit.com',
  'www.reddit.com',
  'zhihu.com',
  'www.zhihu.com',
  'github.com',
  'quora.com',
  'www.quora.com',
  'pinterest.com',
  'm.pinterest.com',
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeHtmlEntities = (text = '') =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const stripTags = (html = '') =>
  decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const getHostname = (url = '') => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const getCanonicalUrlKey = (url = '') => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);

    if ((host === 'chatgpt.com' || host === 'openai.com') && parts.length > 1) {
      const locale = parts[0];
      if (/^[a-z]{2}(?:-[a-z0-9]{2,})?$/i.test(locale)) {
        parsed.pathname = `/${parts.slice(1).join('/')}`;
      }
    }

    parsed.hash = '';
    parsed.search = '';
    return `${host}${parsed.pathname.replace(/\/+$/, '') || '/'}`;
  } catch {
    return url;
  }
};

const unwrapDuckDuckGoUrl = (href = '') => {
  if (!href) return '';

  let normalized = decodeHtmlEntities(href.trim());
  if (normalized.startsWith('//')) normalized = `https:${normalized}`;
  if (normalized.startsWith('/')) normalized = `https://duckduckgo.com${normalized}`;

  try {
    const parsed = new URL(normalized);
    if (parsed.hostname.includes('duckduckgo.com')) {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
};

const getQueryTokens = (text = '') => {
  const matches = String(text)
    .toLowerCase()
    .match(/[a-z0-9]{3,}|[가-힣]{2,}/g);
  if (!matches) return [];

  const stop = new Set(['with', 'from', 'that', 'this', '그리고', '대한', '관련', '차이', '비교']);
  const uniq = [];
  for (const token of matches) {
    if (stop.has(token)) continue;
    if (!uniq.includes(token)) uniq.push(token);
  }
  return uniq;
};

const overlapScore = (topic, title, snippet) => {
  const qTokens = getQueryTokens(topic);
  if (!qTokens.length) return 0;

  const text = `${title} ${snippet}`.toLowerCase();
  let score = 0;
  for (const token of qTokens) {
    if (text.includes(token)) score += 2;
  }
  return score;
};

const scoreResult = (result, originalQuery) => {
  const host = getHostname(result.url);
  let score = overlapScore(originalQuery, result.title, result.snippet);

  if (OFFICIAL_DOMAINS.has(host)) score += 30;
  if (TRUSTED_NEWS_DOMAINS.has(host)) score += 10;
  if (LOW_TRUST_DOMAINS.has(host)) score -= 18;

  if (/chatgpt/i.test(originalQuery) && /chatgpt|openai/i.test(host)) score += 8;
  if (/openai/i.test(originalQuery) && /openai/i.test(host)) score += 8;

  return score;
};

const isIntentMatch = (result, query) => {
  const q = String(query).toLowerCase();
  const text = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();

  if (/chatgpt/.test(q) && /plus/.test(q) && /pro/.test(q)) {
    const hasChatgpt = /chatgpt/.test(text);
    const hasPlus = /plus/.test(text);
    const hasPro = /\bpro\b|\/pro\b/.test(text);
    const hasPlanCue = /pricing|plan|plans|요금/.test(text);
    return hasChatgpt && ((hasPlus && hasPro) || (hasPro && hasPlanCue));
  }

  if ((/chatgpt|openai/.test(q)) && /(status|outage|issue|error|장애|이슈)/.test(q)) {
    return /status\\.openai\\.com|status|incident|outage|error/.test(text);
  }

  return true;
};

const buildQueryVariants = (query) => {
  const variants = [];
  const add = (q) => {
    const normalized = String(q || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    if (!variants.includes(normalized)) variants.push(normalized);
  };

  add(query);

  const ascii = String(query).replace(/[^\x00-\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (ascii && ascii.toLowerCase() !== String(query).toLowerCase()) add(ascii);

  const lower = String(query).toLowerCase();

  if (/chatgpt/.test(lower) && /plus/.test(lower) && /pro/.test(lower)) {
    add('ChatGPT plans pricing plus pro official');
    add('chatgpt.com pricing plus pro');
  }

  if ((/chatgpt|openai/.test(lower)) && /(issue|issues|outage|status|error|장애|이슈|오류|다운)/.test(lower)) {
    add('OpenAI status ChatGPT incidents');
    add('ChatGPT release notes OpenAI help');
  }

  return variants.slice(0, 4);
};

const extractResultItems = (html, maxResults) => {
  const items = [];
  const seen = new Set();

  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const matches = [...html.matchAll(anchorRegex)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const attrs = match[1] || '';
    const titleHtml = match[2] || '';

    if (!/class\s*=\s*["'][^"']*(result__a|result-link)[^"']*["']/i.test(attrs)) continue;

    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;

    const href = hrefMatch[1];
    const title = stripTags(titleHtml);
    const url = unwrapDuckDuckGoUrl(href);

    if (!title || !url) continue;

    const nextIndex = matches[i + 1] ? matches[i + 1].index : match.index + 2200;
    const windowHtml = html.slice(match.index, nextIndex);
    const snippetMatch = windowHtml.match(
      /<(?:a|div|td)[^>]*class\s*=\s*["'][^"']*(result__snippet|result-snippet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|td)>/i,
    );
    const snippet = stripTags(snippetMatch ? snippetMatch[2] : '');

    if (seen.has(url)) continue;
    seen.add(url);

    items.push({
      title,
      url,
      snippet: snippet.slice(0, 300),
    });

    if (items.length >= maxResults) break;
  }

  return items;
};

const extractBingRssItems = (xml, maxResults) => {
  const items = [];
  const seen = new Set();
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const getTag = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? stripTags(m[1]) : '';
  };

  const matches = [...xml.matchAll(itemRegex)];
  for (const match of matches) {
    const block = match[1];
    const title = getTag(block, 'title');
    const url = getTag(block, 'link');
    const snippet = getTag(block, 'description').slice(0, 300);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    items.push({ title, url, snippet });
    if (items.length >= maxResults) break;
  }

  return items;
};

const searchSingleQuery = async (query, options = {}) => {
  const maxResults = clamp(Number(options.maxResults) || DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT);
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const encoded = encodeURIComponent(query);
  const endpoints = [
    `https://lite.duckduckgo.com/lite/?q=${encoded}&kl=us-en`,
    `https://html.duckduckgo.com/html/?q=${encoded}&kl=us-en`,
  ];

  let lastError = null;
  let finalResults = [];

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`DuckDuckGo 응답 오류: ${res.status}`);

      const html = await res.text();
      finalResults = extractResultItems(html, maxResults);
      if (finalResults.length > 0) break;

      if (i < endpoints.length - 1) await sleep(200);
    } catch (e) {
      lastError = e.name === 'AbortError' ? new Error(`웹검색 타임아웃 (${timeoutMs}ms)`) : e;
      webLog.warn('웹검색 시도 실패', { query, endpoint, error: lastError.message });
    } finally {
      clearTimeout(timer);
    }
  }

  if (finalResults.length > 0) return finalResults;

  const fallbackUrl = `https://www.bing.com/search?format=rss&setlang=en-US&cc=US&mkt=en-US&q=${encoded}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(fallbackUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/rss+xml,application/xml,text/xml',
      },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Bing RSS 응답 오류: ${res.status}`);

    const xml = await res.text();
    finalResults = extractBingRssItems(xml, maxResults);
    return finalResults;
  } catch (e) {
    const msg = e.name === 'AbortError' ? `Bing RSS 타임아웃 (${timeoutMs}ms)` : e.message;
    if (lastError) throw lastError;
    throw new Error(msg);
  } finally {
    clearTimeout(timer);
  }
};

const searchWeb = async (query, options = {}) => {
  if (!query || !String(query).trim()) {
    throw new Error('검색어가 비어 있습니다.');
  }

  const maxResults = clamp(Number(options.maxResults) || DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT);
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const variants = buildQueryVariants(query);

  webLog.info('웹검색 시작', { query, maxResults, variants });

  const aggregate = [];
  let lastError = null;

  for (const variant of variants) {
    try {
      const results = await searchSingleQuery(variant, {
        maxResults: Math.max(maxResults, 6),
        timeoutMs,
      });

      results.forEach((item) => {
        aggregate.push({ ...item, sourceQuery: variant });
      });

      await sleep(120);
    } catch (e) {
      lastError = e;
      webLog.warn('쿼리 변형 검색 실패', { query: variant, error: e.message });
    }
  }

  if (!aggregate.length && lastError) {
    webLog.warn('웹검색 실패', { query, error: lastError.message });
    throw lastError;
  }

  const deduped = [];
  const seen = new Set();
  for (const item of aggregate) {
    const dedupeKey = getCanonicalUrlKey(item.url);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(item);
  }

  const scored = deduped
    .map((item) => ({ ...item, score: scoreResult(item, query) }))
    .sort((a, b) => b.score - a.score);

  const intentFiltered = scored.filter((item) => isIntentMatch(item, query));
  const qualityFiltered = (intentFiltered.length ? intentFiltered : scored).filter((item) => item.score > -4);
  const selected = (qualityFiltered.length ? qualityFiltered : intentFiltered.length ? intentFiltered : scored)
    .slice(0, maxResults)
    .map(({ title, url, snippet }) => ({ title, url, snippet }));

  webLog.info('웹검색 완료', {
    query,
    count: selected.length,
    domains: selected.slice(0, 4).map((r) => getHostname(r.url) || 'unknown'),
  });

  return {
    query: String(query).trim(),
    fetchedAt: new Date().toISOString(),
    results: selected,
  };
};

module.exports = { searchWeb };
