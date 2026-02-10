<img width="694" height="158" alt="image" src="https://github.com/user-attachments/assets/75f1fa20-2e03-4b56-8c29-1756b3e0f406" />


# ViruAgent

> 터미널에서 티스토리 블로그 글을 만들고, 다듬고, 발행하는 CLI 도구

티스토리 API를 역분석해서 OpenAI와 엮었습니다.
글감 잡기 → 초안 생성 → 수정 → 발행까지 터미널 안에서 끝납니다.

공식 API가 아닌 비공식 내부 통신을 쓰기 때문에, 학습/실험 용도로 만들었습니다.

---

## 뭘 할 수 있나

- **AI 대화로 글쓰기** — 챗처럼 대화하면서 아이디어를 다듬고, `/write`로 초안을 뽑고, `/edit`로 고칩니다.
- **브라우저 로그인으로 세션 관리** — OAuth 설정 없이 Playwright로 실제 로그인해서 쿠키를 가져옵니다.
- **CLI UX** — 커맨드 힌트, 화살표 키 메뉴, 상태바 등을 넣어서 터미널에서도 불편하지 않게 만들었습니다.
- **HTML 유지하면서 수정** — 글 구조를 깨뜨리지 않고 특정 부분만 고치거나 말투를 바꿀 수 있습니다.

---

## 시작하기

**필요한 것**: Node.js 18+, OpenAI API Key

```bash
git clone https://github.com/your-username/viruagent.git
cd viruagent
npm install
cp .env.example .env
# .env 파일에 OPENAI_API_KEY 입력
npm start
```

---

## 명령어

<img width="678" height="436" alt="image" src="https://github.com/user-attachments/assets/32c47211-b82e-4ca3-a02d-5201914e9d21" />


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

## 기술 스택

- **런타임**: Node.js (CommonJS)
- **AI**: OpenAI SDK
- **자동화**: Playwright , Fetch
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
