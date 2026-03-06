# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e5]:
    - generic [ref=e6]:
      - generic [ref=e7]: ○ ○
      - generic [ref=e8]: █▀▀ █▀▄
    - generic [ref=e9]: GitHub Copilot v0.1.30
    - generic [ref=e10]: Describe a task to get started.
    - generic [ref=e11]: "Tip: /model Select AI model to use"
    - generic [ref=e12]: Copilot uses AI, so always check for mistakes.
  - generic [ref=e14]:
    - text: ●
    - generic [ref=e15]: "Environment loaded: 1 model"
  - generic [ref=e17]:
    - generic [ref=e18]:
      - generic [ref=e19]: ❯
      - 'textbox "Type @ to mention files, # for issues/PRs, / for commands, or ? for shortcuts" [ref=e20]'
    - generic [ref=e21]:
      - generic [ref=e23]: Connecting...
      - generic [ref=e24]:
        - combobox "Agent mode" [ref=e25] [cursor=pointer]:
          - option "interactive" [selected]
          - option "plan"
          - option "autopilot"
        - combobox [ref=e26] [cursor=pointer]:
          - option "gpt-4.1" [selected]
        - button "/new" [ref=e27] [cursor=pointer]
        - button "/quit" [ref=e28] [cursor=pointer]
```