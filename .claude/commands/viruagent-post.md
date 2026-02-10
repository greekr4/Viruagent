---
description: Generate and publish a blog post with ViruAgent
allowed-tools: Bash, AskUserQuestion
---

# ViruAgent Blog Posting

Generate an AI blog post on the user's requested topic and publish it to Tistory.

Topic: $ARGUMENTS

## Workflow

1. First, fetch the category list:
```bash
node src/cli-post.js --list-categories
```

2. Parse the category list result and use AskUserQuestion to ask the user:
   - **Category**: Select from the fetched category list (present as options)
   - **Visibility**: Choose between public / private / protected
   - **Publish mode**: Publish now / Save as draft / Preview only (dry-run)

3. Run the CLI script based on the user's selections:
```bash
node src/cli-post.js --topic "$ARGUMENTS" --category [SELECTED_ID] --visibility [SELECTED_VALUE] [--draft] [--dry-run]
```

4. Parse the JSON output and display the result to the user:
   - On success: Show title, tags, and URL (if published)
   - On failure: Show error message

## Important Notes
- If `$ARGUMENTS` is empty, use AskUserQuestion to ask for the topic first
- Only parse JSON output (last line of stdout)
- On error, inform the user of the cause and suggest a solution
