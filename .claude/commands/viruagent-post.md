---
description: ViruAgent로 블로그 글을 생성하고 발행합니다
allowed-tools: Bash, AskUserQuestion
---

# ViruAgent 블로그 포스팅

사용자가 요청한 주제로 AI 블로그 글을 생성하고 티스토리에 발행합니다.

주제: $ARGUMENTS

## 워크플로우

1. 먼저 카테고리 목록을 조회합니다:
```bash
node src/cli-post.js --list-categories
```

2. 카테고리 목록 결과를 파싱해서, AskUserQuestion 도구로 사용자에게 다음을 물어봅니다:
   - **카테고리 선택**: 조회된 카테고리 목록에서 선택 (옵션으로 제시)
   - **공개 여부**: public(공개) / private(비공개) / protected(보호) 중 선택
   - **발행 방식**: 바로 발행 / 임시저장 / 미리보기만(dry-run) 중 선택

3. 사용자 선택에 따라 CLI 스크립트를 실행합니다:
```bash
node src/cli-post.js --topic "$ARGUMENTS" --category [선택된ID] --visibility [선택값] [--draft] [--dry-run]
```

4. 실행 결과 JSON을 파싱해서 사용자에게 보기 좋게 보여줍니다:
   - 성공 시: 제목, 태그, URL(발행인 경우) 표시
   - 실패 시: 에러 메시지 표시

## 주의사항
- `$ARGUMENTS`가 비어있으면 AskUserQuestion으로 주제를 먼저 물어보세요
- JSON 출력만 파싱하세요 (stdout의 마지막 줄)
- 에러 발생 시 사용자에게 원인과 해결 방법을 안내하세요
