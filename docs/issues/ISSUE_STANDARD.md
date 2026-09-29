# Issue Standard & Framework

A strong issue report follows a structured framework (often referred to as the **Steps-Expected-Actual (SEA)** or **Context-Problem-Solution** format, widely adopted across the industry). It minimizes back-and-forth by proactively answering the questions a developer needs to fix it.

## The Standard Issue Format

```markdown
### 📝 Description
A clear and concise description of what the issue is. (e.g., "The player falls through the floor when jumping in the corner of the map").

### 🔄 Steps to Reproduce
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

### 🎯 Expected Behavior
A clear and concise description of what you expected to happen.

### 💥 Actual Behavior
What actually happened instead. (Include screenshots, video, or logs if applicable).

### 🚨 Severity & Impact
**[Select One: Critical | High | Medium | Low]**
- Briefly explain *why* it has this severity (e.g., "Blocks user login" vs "Small typo in menu").

### 💻 Environment
- **OS:** macOS 14.x / Windows 11
- **Version/Commit:** e.g., v1.2.0 or commit `1a2b3c`
- **Other Context:** (Browser, hardware, etc.)

### 💡 Proposed Solution (Optional)
If you have an idea of where the bug is or how to fix it, drop it here.
```

## Severity Levels (Industry Standard)

* **P0 / Critical:** The system is crashing, unplayable, or a core feature is completely broken for all users. Must be fixed immediately.
* **P1 / High:** A major feature is broken but it might only affect some users, or there is no reasonable workaround. Needs to be fixed in the current sprint.
* **P2 / Medium:** A feature is broken or behaving weirdly, but a workaround exists. Not a hard blocker.
* **P3 / Low:** Minor bugs, visual glitches, cosmetic issues, or small enhancements. Nice to have.

## How to Create an Issue using `gh` CLI

You can pass a template file directly to the GitHub CLI. If you save the format above into a file like `docs/issues/template.md`, you can run:

```bash
gh issue create --title "Short summary of the bug" --body-file docs/issues/template.md --label "bug"
```

Alternatively, if you run `gh issue create` with no arguments, the CLI will open an interactive menu and launch your default terminal editor (like `nano` or `vim`) so you can type out the format manually.
