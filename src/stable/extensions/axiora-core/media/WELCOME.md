# Welcome to Axiora-Code / مرحباً بك في Axiora-Code

## Display language / لغة الواجهة
- Settings → search **`axiora.language`** → choose **English** or **العربية**, then restart.
- الإعدادات ← ابحث عن **`axiora.language`** ← اختر **العربية** أو **English** ثم أعد التشغيل.
- Or Command Palette (Ctrl+Shift+P): **Axiora-Code: Switch Display Language**.

## Themes / السمات
Axiora-Code ships **Axiora Dark** (default) and **Axiora Light** — soft-contrast palettes, easy on the eyes.
Change with Ctrl+K Ctrl+T. / لتغيير السمة: Ctrl+K ثم Ctrl+T.

## Full color customization / تخصيص الألوان بالكامل
Open Settings (JSON) via Command Palette → *Preferences: Open User Settings (JSON)* and add:

```jsonc
"workbench.colorCustomizations": {
  "[Axiora Dark]": {
    "editor.background": "#1E2233",
    "statusBar.background": "#2F8F8A"
  }
},
"editor.tokenColorCustomizations": {
  "[Axiora Dark]": {
    "comments": "#7C84A8",
    "strings": "#9BE3C0",
    "keywords": "#B69CFF"
  }
}
```
Every UI color key is documented at https://code.visualstudio.com/api/references/theme-color.

## Extensions / الإضافات
Extensions are installed from **Open VSX** (open-vsx.org) via the Extensions view (Ctrl+Shift+X).
الإضافات تُثبَّت من متجر **Open VSX** عبر لوحة الإضافات (Ctrl+Shift+X).
