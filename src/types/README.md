# src/types

- `nodes.ts` — `bun run codegen` の生成物（ComfyUI `/object_info` → 型付き `WorkflowBuilder`）。手で編集しない。モデル・カスタムノード追加後に ComfyUI 起動中で再生成。lint / format 対象外。
- `yaml.d.ts` — `.yaml` import の型宣言。
