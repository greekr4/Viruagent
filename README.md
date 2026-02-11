<img width="525" height="113" alt="image" src="https://github.com/user-attachments/assets/8bbd21d3-5f14-4d11-933d-17bdf6969ebf" />


# ViruAgent

> 터미널에서 티스토리 블로그 글을 만들고, 다듬고, 발행하는 CLI 도구

티스토리 API를 역분석해서 OpenAI와 엮었습니다.
글감 잡기 → 초안 생성 → 수정 → 발행까지 터미널 안에서 끝납니다.

공식 API가 아닌 비공식 내부 통신을 쓰기 때문에, 학습/실험 용도로 만들었습니다.

---

## 뭘 할 수 있나

- **AI 대화로 글쓰기** — 챗처럼 대화하면서 아이디어를 다듬고, `/write`로 초안을 뽑고, `/edit`로 고칩니다.
- **Unsplash 이미지 자동 삽입** — 글 생성 시 주제에 맞는 이미지를 자동 검색하고 티스토리에 업로드합니다. 첫 번째 이미지가 썸네일로 설정됩니다.
- **브라우저 로그인으로 세션 관리** — OAuth 설정 없이 Playwright로 실제 로그인해서 쿠키를 가져옵니다.
- **유연한 글 구조** — 5가지 글 유형(튜토리얼, 비교/리뷰, 리스트, 정보 가이드, 인사이트)을 AI가 주제에 맞게 자율 선택합니다.
- **CLI UX** — 커맨드 힌트, 화살표 키 메뉴, 상태바 등을 넣어서 터미널에서도 불편하지 않게 만들었습니다.
- **HTML 유지하면서 수정** — 글 구조를 깨뜨리지 않고 특정 부분만 고치거나 말투를 바꿀 수 있습니다.

---

## 시작하기

**필요한 것**: Node.js 18+, OpenAI API Key

```bash
npm install -g viruagent
viruagent
```

또는 설치 없이 바로 실행:

```bash
npx viruagent
```

최초 실행 시 OpenAI API Key를 입력하면 `~/.viruagent/config.json`에 자동 저장됩니다.
Unsplash API Key는 `/set api` 명령어로 나중에 설정할 수 있습니다.

- OpenAI API Key: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Unsplash API Key (선택): [unsplash.com/developers](https://unsplash.com/developers) (시간당 50회 제한)

---

## 명령어

<img width="547" height="441" alt="image" src="https://github.com/user-attachments/assets/bda2730d-d055-4872-b2b9-e24aeb7d5fd9" />

---



| 명령어          | 설명                                         |
| --------------- | -------------------------------------------- |
| `/write <주제>` | AI가 블로그 글 초안 생성                     |
| `/edit <지시>`  | 초안 수정 ("더 친근하게 바꿔줘" 같은 식으로) |
| `/preview`      | 작성 중인 글 미리보기                        |
| `/publish`      | 글 발행                                      |
| `/set`          | 카테고리, 공개 설정, 모델, 말투 변경         |
| `/list`         | 최근 발행 글 목록                            |
| `/login`        | 티스토리 세션 갱신                           |
| `/logout`        | 티스토리 세션 삭제                           |

---

## Claude Code로 글쓰기

[Claude Code](https://claude.com/claude-code)에서 자연어로 명령할 수 있습니다.

```
> viruagent로 블로그에 글 아무거나 써줘 카테고리는 "기타"
```

<img width="1054" height="896" alt="image" src="https://github.com/user-attachments/assets/9e30e0ed-32f9-41a4-b39f-e4e6863d5d2d" />



카테고리, 공개 여부, 발행 방식을 물어본 뒤 AI가 글을 생성해서 티스토리에 발행합니다.


### 직접 CLI로 실행

```bash
# 카테고리 목록 조회
node src/cli-post.js --list-categories

# 글 생성 + 발행
node src/cli-post.js --topic "주제" --category 1247460 --visibility public

# 미리보기만 (발행 안 함)
node src/cli-post.js --topic "주제" --dry-run

# 임시저장
node src/cli-post.js --topic "주제" --draft
```

---

## Unsplash 이미지 연동

글 생성 시 본문에 `<!-- IMAGE: keyword -->` 플레이스홀더가 자동 삽입됩니다. Unsplash API Key가 설정되어 있으면 (`/set api`):

1. 키워드로 Unsplash에서 이미지 검색
2. 이미지 다운로드 → 티스토리에 업로드
3. 티스토리 네이티브 이미지 치환자(`[##_Image|kage@..._##]`)로 변환
4. **첫 번째 이미지가 자동으로 글 썸네일(대표 이미지)로 설정**

키가 없으면 이미지 처리를 건너뛰고 글만 발행합니다.

---

## 시스템 프롬프트 커스터마이징

글의 톤, 구조, HTML 스타일은 `config/system-prompt.md`에서 수정할 수 있습니다.

```
config/
├── prompt-config.json   # 모델, 말투, 이미지 설정
└── system-prompt.md     # AI 글쓰기 규칙 (글 유형, HTML 레퍼런스, 톤)
```

### 글 유형 (AI가 주제에 맞게 자율 선택)

| 유형 | 구조 |
|------|------|
| 튜토리얼 | 준비물 → 단계 → 결과 확인 → 트러블슈팅 |
| 비교/리뷰 | 비교 테이블 + 장단점 → 추천 |
| 리스트 | 번호 소제목 + 항목별 팁 |
| 정보 가이드 | 문제 → 원인 → 해결 → FAQ |
| 인사이트 | 화두 → 근거 → 시사점 → 액션 |

### prompt-config.json 설정

```json
{
  "defaultModel": "gpt-4o-mini",
  "defaultTone": "정보전달",
  "defaultLength": 2500,
  "imageSource": "unsplash",
  "imagesPerPost": 3
}
```

---

## 로그

실행 로그가 `logs/` 폴더에 날짜별로 기록됩니다.

```
logs/
└── 2026-02-11.log
```

이미지 업로드 실패, API 오류 등의 디버깅에 활용할 수 있습니다.

```
[10:30:15.123] [INFO] [unsplash] 이미지 플레이스홀더 3개 발견
[10:30:16.456] [INFO] [unsplash] Unsplash 이미지 찾음 | {"keyword":"laptop"}
[10:30:17.789] [INFO] [tistory] 이미지 업로드 성공 | {"url":"https://blog.kakaocdn.net/..."}
[10:30:17.800] [ERROR] [tistory] 이미지 업로드 실패 | {"status":500}
```

---

## 기술 스택

- **런타임**: Node.js (CommonJS)
- **AI**: OpenAI SDK
- **이미지**: Unsplash API
- **자동화**: Playwright, Fetch
- **CLI**: Chalk, Readline

---

## 주의사항

이 프로젝트는 티스토리의 **비공식 내부 API**를 사용합니다.

- 정책이 바뀌면 언제든 안 될 수 있습니다.
- 사용에 따른 책임은 본인에게 있습니다.

교육/학습 목적으로 만들었습니다.

---

## License

MIT
