const { createLogger } = require('./logger');
const log = createLogger('unsplash');

const getUnsplashKey = () => process.env.UNSPLASH_ACCESS_KEY;

/**
 * Unsplash에서 키워드로 이미지 검색
 * @param {string} keyword - 검색 키워드 (영문)
 * @returns {Promise<Object|null>} { url, alt, credit, link } 또는 null
 */
const searchImage = async (keyword) => {
  if (!getUnsplashKey()) return null;

  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${getUnsplashKey()}` },
    });

    if (!res.ok) {
      log.error('Unsplash 검색 실패', { keyword, status: res.status });
      return null;
    }

    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      log.warn('Unsplash 검색 결과 없음', { keyword });
      return null;
    }

    const photo = data.results[0];
    return {
      url: photo.urls.regular,
      alt: photo.alt_description || keyword,
      credit: photo.user.name,
      link: photo.user.links.html,
    };
  } catch (e) {
    log.error('Unsplash 검색 예외', { keyword, error: e.message });
    return null;
  }
};

/**
 * 이미지 URL에서 Buffer로 다운로드
 * @param {string} imageUrl
 * @returns {Promise<Buffer|null>}
 */
const downloadImage = async (imageUrl) => {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      log.error('이미지 다운로드 실패', { imageUrl, status: res.status });
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    log.info('이미지 다운로드 완료', { size: buf.length });
    return buf;
  } catch (e) {
    log.error('이미지 다운로드 예외', { imageUrl, error: e.message });
    return null;
  }
};

/**
 * HTML 본문의 <!-- IMAGE: keyword --> 플레이스홀더를 티스토리 업로드 이미지로 치환
 * @param {string} html - HTML 본문
 * @param {Object} [options]
 * @param {Function} [options.uploadFn] - 티스토리 uploadImage 함수 (없으면 외부 img 태그 사용)
 * @returns {Promise<{html: string, thumbnailUrl: string|null, thumbnailKage: string|null}>}
 */
const replaceImagePlaceholders = async (html, options = {}) => {
  let thumbnailUrl = null;
  let thumbnailKage = null;

  if (!getUnsplashKey()) {
    log.warn('getUnsplashKey() 미설정 — 이미지 처리 건너뜀');
    return { html, thumbnailUrl, thumbnailKage };
  }

  const pattern = /<!-- IMAGE: (.+?) -->/g;
  const matches = [...html.matchAll(pattern)];
  log.info(`이미지 플레이스홀더 ${matches.length}개 발견`);
  if (matches.length === 0) return { html, thumbnailUrl, thumbnailKage };

  const { uploadFn } = options;
  log.info(`업로드 함수: ${uploadFn ? '있음' : '없음 (폴백 모드)'}`);

  let result = html;
  for (const match of matches) {
    const keyword = match[1].trim();
    log.info(`이미지 처리 시작`, { keyword });

    const image = await searchImage(keyword);
    if (!image) {
      log.warn(`이미지 검색 실패 — 플레이스홀더 제거`, { keyword });
      result = result.replace(match[0], '');
      continue;
    }
    log.info(`Unsplash 이미지 찾음`, { keyword, url: image.url.substring(0, 80) });

    // 티스토리 업로드 시도
    if (uploadFn) {
      try {
        const buffer = await downloadImage(image.url);
        if (!buffer) {
          log.error('이미지 버퍼 null', { keyword });
        } else {
          log.info('티스토리 업로드 시도', { keyword, bufferSize: buffer.length });
          const uploadResult = await uploadFn(buffer, `${keyword.replace(/\s+/g, '_')}.jpg`);
          log.info('업로드 결과', { keyword, uploadResult });

          if (uploadResult?.url) {
            const dnaMatch = uploadResult.url.match(/\/dna\/(.+)/);
            if (dnaMatch) {
              const kagePath = `kage@${dnaMatch[1]}`;
              const tistoryImg = `<p>[##_Image|${kagePath}|CDM|1.3|{"originWidth":0,"originHeight":0,"style":"alignCenter"}_##]</p>`;
              result = result.replace(match[0], tistoryImg);
              if (!thumbnailUrl) {
                thumbnailUrl = uploadResult.url;
                thumbnailKage = kagePath;
              }
              log.info('티스토리 치환자 삽입 완료', { keyword, kagePath });
              continue;
            }
            // dna 패턴 없으면 img 태그 폴백
            log.warn('dna 패턴 미발견 — img 태그 폴백', { keyword, url: uploadResult.url });
            const tistoryImg = `<p data-ke-size="size16"><img src="${uploadResult.url}" alt="${image.alt}" /></p>`;
            result = result.replace(match[0], tistoryImg);
            if (!thumbnailUrl) thumbnailUrl = uploadResult.url;
            continue;
          }
        }
      } catch (e) {
        log.error('업로드 실패 — 외부 이미지 폴백', { keyword, error: e.message, stack: e.stack });
      }
    }

    // 폴백: 외부 이미지 태그
    log.info('외부 이미지 태그 사용', { keyword });
    const imgTag = `<p data-ke-size="size16"><img src="${image.url}" alt="${image.alt}" /></p>`;
    result = result.replace(match[0], imgTag);
  }

  log.info('이미지 처리 완료', { thumbnailUrl: thumbnailUrl?.substring(0, 80), thumbnailKage });
  return { html: result, thumbnailUrl, thumbnailKage };
};

module.exports = { searchImage, downloadImage, replaceImagePlaceholders };
